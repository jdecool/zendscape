<?php

declare(strict_types=1);

namespace Zendscape\Http;

use Amp\Http\HttpStatus;
use Amp\Http\Server\Request;
use Amp\Http\Server\RequestHandler;
use Amp\Http\Server\Response;
use Zendscape\Diff;
use Zendscape\GraphWalk;
use Zendscape\Session;
use Zendscape\Snapshot\NodeDetail;
use Zendscape\Snapshot\NodeSummary;
use Zendscape\Snapshot\Reference;
use Zendscape\Snapshot\Snapshot;

/**
 * JSON and binary API over a session, plus the built frontend.
 *
 * String values are masked unless a request passes ?reveal=strings
 * (ADR 0007): labels of string nodes embed their value too, so masking
 * applies to every node summary, not only to node details.
 */
final class Api implements RequestHandler
{
    private const string MASKED_TYPE = 'StringContext';

    /** @var array<int, string> snapshot id => encoded allocations */
    private array $allocationPayloads = [];

    /** @var array<string, string> "from:to" => encoded diff, computing one takes seconds on large heaps */
    private array $diffs = [];

    /** @var array<int, string> snapshot id => uploaded file, deleted when the snapshot is closed */
    private array $uploads = [];

    public function __construct(
        private readonly Session $session,
        private readonly string $publicDir,
        private readonly string $uploadDir,
    ) {}

    public function handleRequest(Request $request): Response
    {
        // A loopback server is reachable from any web page through DNS rebinding, where the
        // page's own domain resolves to 127.0.0.1: only a loopback name in Host is trusted.
        // The port is not checked so Docker can publish the server on another one.
        $hostname = preg_replace('/:\d+$/', '', $request->getHeader('host') ?? '');
        if (!in_array($hostname, ['127.0.0.1', 'localhost', '[::1]'], true)) {
            return self::error(HttpStatus::FORBIDDEN, 'Unexpected Host header');
        }

        $path = $request->getUri()->getPath();
        if (!str_starts_with($path, '/api/')) {
            return $this->staticFile($path);
        }

        try {
            return $this->route($request, $request->getMethod(), $path);
        } catch (NotFound $e) {
            return self::error(HttpStatus::NOT_FOUND, $e->getMessage());
        } catch (\InvalidArgumentException $e) {
            return self::error(HttpStatus::BAD_REQUEST, $e->getMessage());
        }
    }

    public function close(int $id): void
    {
        $this->session->remove($id);
        unset($this->allocationPayloads[$id]);
        $this->diffs = array_filter($this->diffs, static fn(string $key): bool => !in_array((string) $id, explode(':', $key), true), ARRAY_FILTER_USE_KEY);
        if (isset($this->uploads[$id])) {
            @unlink($this->uploads[$id]);
            unset($this->uploads[$id]);
        }
    }

    private function route(Request $request, string $method, string $path): Response
    {
        $reveal = self::query($request, 'reveal') === 'strings';

        if ($path === '/api/snapshots') {
            return match ($method) {
                'GET' => self::json($this->listSnapshots()),
                'POST' => $this->upload($request),
                default => self::error(HttpStatus::METHOD_NOT_ALLOWED, 'Method not allowed'),
            };
        }

        if ($path === '/api/diff' && $method === 'GET') {
            return $this->diff($request);
        }

        if (preg_match('#^/api/snapshots/(\d+)(/.*)?$#', $path, $m) !== 1) {
            throw new NotFound('Unknown endpoint');
        }
        $id = (int) $m[1];
        $snapshot = $this->session->has($id) ? $this->session->snapshot($id) : throw new NotFound("No snapshot {$id}");
        $rest = $m[2] ?? '';

        if ($rest === '' && $method === 'DELETE') {
            $this->close($id);

            return new Response(HttpStatus::NO_CONTENT);
        }
        if ($method !== 'GET') {
            return self::error(HttpStatus::METHOD_NOT_ALLOWED, 'Method not allowed');
        }

        $limit = self::intQuery($request, 'limit', 100, 1, 10_000);

        return match (true) {
            $rest === '/allocations' => new Response(HttpStatus::OK, ['content-type' => 'application/octet-stream'], $this->allocationPayloads[$id] ??= AllocationsPayload::encode($snapshot)),
            $rest === '/classes' => self::json($snapshot->classRanking()),
            $rest === '/top-retained' => self::json($this->mask($snapshot->topRetained($limit), $reveal)),
            $rest === '/search' => self::json($this->mask($snapshot->search(self::query($request, 'q') ?? throw new \InvalidArgumentException('Missing q'), $limit), $reveal)),
            preg_match('#^/classes/([^/]+)/instances$#', $rest, $c) === 1 => self::json($this->mask(array_slice($snapshot->nodesOfClass(rawurldecode($c[1])), 0, $limit), $reveal)),
            preg_match('#^/address/(?:0x)?([0-9a-fA-F]{1,16})$#', $rest, $a) === 1 => self::json(['node' => $snapshot->findByAddress((int) hexdec($a[1]))]),
            preg_match('#^/nodes/(\d+)(/[a-z-]+)?$#', $rest, $n) === 1 => $this->node($request, $snapshot, (int) $n[1], $n[2] ?? '', $reveal),
            default => throw new NotFound('Unknown endpoint'),
        };
    }

    private function node(Request $request, Snapshot $snapshot, int $nodeId, string $action, bool $reveal): Response
    {
        if (!$snapshot->hasNode($nodeId)) {
            throw new NotFound("No node {$nodeId}");
        }

        return match ($action) {
            '' => self::json($this->maskDetail($snapshot->detail($nodeId), $reveal)),
            '/path' => self::json($this->maskReferences($snapshot->pathToRoot($nodeId), $reveal)),
            '/retention-paths' => self::json(array_map(
                fn(array $path): array => $this->maskReferences($path, $reveal),
                GraphWalk::retentionPaths($snapshot, $nodeId, self::intQuery($request, 'limit', 10, 1, 100), 256),
            )),
            '/references' => self::json($this->neighbourhood($request, $snapshot, $nodeId, $reveal)),
            default => throw new NotFound('Unknown endpoint'),
        };
    }

    /** @return array<string, mixed> */
    private function neighbourhood(Request $request, Snapshot $snapshot, int $nodeId, bool $reveal): array
    {
        $direction = self::query($request, 'direction') ?? 'out';
        if (!in_array($direction, ['in', 'out'], true)) {
            throw new \InvalidArgumentException('direction must be in or out');
        }
        $graph = GraphWalk::neighbourhood(
            $snapshot,
            $nodeId,
            $direction === 'out',
            self::intQuery($request, 'depth', 1, 1, 8),
            self::intQuery($request, 'limit', 500, 1, 10_000),
        );

        return [...$graph, 'nodes' => $this->mask(array_values($graph['nodes']), $reveal)];
    }

    private function diff(Request $request): Response
    {
        $ids = [];
        foreach (['from', 'to'] as $name) {
            $id = self::intQuery($request, $name, 0, 0, PHP_INT_MAX);
            $ids[] = $this->session->has($id) ? $id : throw new NotFound("No snapshot {$id}");
        }
        [$from, $to] = $ids;

        $json = $this->diffs["{$from}:{$to}"] ??= json_encode(
            Diff::compute($this->session->snapshot($from), $this->session->snapshot($to)),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES,
        );

        return new Response(HttpStatus::OK, ['content-type' => 'application/json'], $json);
    }

    /** @return list<array{id: int, name: string, nodeCount: int, handlesAvailable: bool}> */
    private function listSnapshots(): array
    {
        $list = [];
        foreach ($this->session->entries() as $id => ['name' => $name, 'snapshot' => $snapshot]) {
            $list[] = ['id' => $id, 'name' => $name, 'nodeCount' => $snapshot->nodeCount(), 'handlesAvailable' => $snapshot->objectHandles() !== null];
        }

        return $list;
    }

    private function upload(Request $request): Response
    {
        // Cross-site forms can POST text/plain without a preflight; requiring this
        // type makes foreign pages go through a CORS preflight we never grant.
        if ($request->getHeader('content-type') !== 'application/octet-stream') {
            return self::error(HttpStatus::UNSUPPORTED_MEDIA_TYPE, 'Upload the snapshot as application/octet-stream');
        }
        $name = basename($request->getHeader('x-filename') ?? 'snapshot.rmem');
        $file = $this->uploadDir . '/' . bin2hex(random_bytes(8)) . '.rmem';
        $handle = fopen($file, 'xb') ?: throw new \RuntimeException("Cannot create {$file}");
        // ponytail: blocking writes and load; a large upload stalls other requests, fine for a single local user.
        $body = $request->getBody();
        while (($chunk = $body->read()) !== null) {
            fwrite($handle, $chunk);
        }
        fclose($handle);

        try {
            $snapshot = Snapshot::open($file);
        } catch (\Throwable $e) {
            @unlink($file);

            return self::error(HttpStatus::UNPROCESSABLE_ENTITY, "Not a readable .rmem snapshot: {$e->getMessage()}");
        }
        $id = $this->session->add($name, $snapshot);
        $this->uploads[$id] = $file;

        return self::json(['id' => $id, 'name' => $name], HttpStatus::CREATED);
    }

    private function staticFile(string $path): Response
    {
        $relative = $path === '/' ? 'index.html' : ltrim($path, '/');
        $file = realpath($this->publicDir . '/' . $relative);
        $root = realpath($this->publicDir);

        if ($root === false) {
            return new Response(HttpStatus::NOT_FOUND, ['content-type' => 'text/plain'], "Frontend not built: run `npm run build` in frontend/.\n");
        }
        if ($file === false || !str_starts_with($file, $root . DIRECTORY_SEPARATOR) || !is_file($file)) {
            return self::error(HttpStatus::NOT_FOUND, 'Not found');
        }

        $types = ['html' => 'text/html; charset=utf-8', 'js' => 'text/javascript', 'css' => 'text/css', 'svg' => 'image/svg+xml', 'json' => 'application/json', 'woff2' => 'font/woff2', 'woff' => 'font/woff'];

        return new Response(
            HttpStatus::OK,
            ['content-type' => $types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'],
            (string) file_get_contents($file),
        );
    }

    /**
     * @param list<NodeSummary> $nodes
     * @return list<NodeSummary>
     */
    private function mask(array $nodes, bool $reveal): array
    {
        return $reveal ? $nodes : array_map(self::maskSummary(...), $nodes);
    }

    /**
     * @param list<Reference> $references
     * @return list<Reference>
     */
    private function maskReferences(array $references, bool $reveal): array
    {
        return $reveal ? $references : array_map(
            static fn(Reference $r): Reference => new Reference(self::maskSummary($r->node), $r->linkName, $r->strong),
            $references,
        );
    }

    private function maskDetail(NodeDetail $d, bool $reveal): NodeDetail
    {
        if ($reveal || $d->type !== self::MASKED_TYPE) {
            return $d;
        }

        return new NodeDetail($d->id, $d->type, $d->class, self::maskedLabel($d->type), $d->shallowSize, $d->retainedSize, $d->address, $d->refcount, null, $d->sourceLocation);
    }

    private static function maskSummary(NodeSummary $s): NodeSummary
    {
        return $s->type === self::MASKED_TYPE
            ? new NodeSummary($s->id, $s->type, self::maskedLabel($s->type), $s->shallowSize, $s->retainedSize)
            : $s;
    }

    private static function maskedLabel(string $type): string
    {
        return "{$type} = (hidden)";
    }

    private static function query(Request $request, string $name): ?string
    {
        return $request->getQueryParameter($name);
    }

    private static function intQuery(Request $request, string $name, int $default, int $min, int $max): int
    {
        $value = self::query($request, $name);
        if ($value === null) {
            return $default;
        }
        if (preg_match('/^\d+$/', $value) !== 1) {
            throw new \InvalidArgumentException("{$name} must be an integer");
        }

        return max($min, min($max, (int) $value));
    }

    private static function json(mixed $value, int $status = HttpStatus::OK): Response
    {
        return new Response($status, ['content-type' => 'application/json'], json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    }

    private static function error(int $status, string $message): Response
    {
        return self::json(['error' => $message], $status);
    }
}
