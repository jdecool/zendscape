<?php

declare(strict_types=1);

namespace Zendscape\Tests\Http;

use PHPUnit\Framework\TestCase;

/**
 * Drives the real `zendscape serve` process over HTTP, as the frontend will.
 */
final class ApiTest extends TestCase
{
    private const string FIXTURES = __DIR__ . '/../../../fixtures';

    /** @var resource|null */
    private static $process = null;

    private static string $baseUrl = '';

    private static int $pid = 0;

    public static function setUpBeforeClass(): void
    {
        $process = proc_open(
            [PHP_BINARY, __DIR__ . '/../../bin/zendscape', 'serve', '--port=0', self::FIXTURES . '/static-cache.t1.rmem', self::FIXTURES . '/object-cycle.t1.rmem', self::FIXTURES . '/static-cache.t0.rmem'],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
        );
        self::assertIsResource($process);
        self::$process = $process;
        self::$pid = proc_get_status($process)['pid'];

        $line = fgets($pipes[1]);
        if ($line === false || preg_match('#(http://127\.0\.0\.1:\d+)/#', $line, $m) !== 1) {
            self::fail('Server did not start: ' . stream_get_contents($pipes[2]));
        }
        self::$baseUrl = $m[1];
    }

    public static function tearDownAfterClass(): void
    {
        if (self::$process !== null) {
            proc_terminate(self::$process, SIGINT);
            proc_close(self::$process);
        }
    }

    public function testListsOpenSnapshots(): void
    {
        $snapshots = self::snapshots();

        self::assertSame([1, 2, 3], array_column($snapshots, 'id'));
        self::assertSame(['static-cache.t1.rmem', 'object-cycle.t1.rmem', 'static-cache.t0.rmem'], array_column($snapshots, 'name'));
        self::assertSame([true, true, true], array_column($snapshots, 'handlesAvailable'));
        self::assertGreaterThan(10_000, $snapshots[0]['nodeCount']);
    }

    public function testFindsTheLeakFromClassesToRetentionPath(): void
    {
        /** @var list<array{class: string, count: int, totalShallowSize: int}> $classes */
        $classes = self::getJson('/api/snapshots/1/classes');
        $ranking = array_column($classes, 'count', 'class');
        self::assertSame(1100, $ranking['Product']);

        $instances = self::nodes('/api/snapshots/1/classes/Product/instances?limit=3');
        self::assertCount(3, $instances);
        $leaked = $instances[0]['id'];

        $detail = self::detail("/api/snapshots/1/nodes/{$leaked}");
        self::assertSame('Product', $detail['class']);
        self::assertSame(['node' => $leaked], self::getJson(sprintf('/api/snapshots/1/address/0x%x', $detail['address'])));

        $paths = self::paths("/api/snapshots/1/nodes/{$leaked}/retention-paths");
        self::assertCount(1, $paths);
        $links = array_column($paths[0], 'linkName');
        self::assertSame('class_table', end($links));
        self::assertContains('items', $links);
        self::assertSame(array_column(self::path("/api/snapshots/1/nodes/{$leaked}/path"), 'linkName'), $links);
    }

    public function testGarbageCyclesHaveNoRetentionPath(): void
    {
        $leaked = self::nodes('/api/snapshots/2/classes/TreeNode/instances?limit=1')[0]['id'];

        self::assertSame([], self::paths("/api/snapshots/2/nodes/{$leaked}/retention-paths"));
    }

    public function testReferencesInBothDirections(): void
    {
        $leaked = self::nodes('/api/snapshots/1/classes/Product/instances?limit=1')[0]['id'];

        $out = self::references("/api/snapshots/1/nodes/{$leaked}/references?direction=out&depth=2");
        self::assertFalse($out['truncated']);
        self::assertContains($leaked, array_column($out['edges'], 'from'));
        self::assertCount(count($out['nodes']), array_unique(array_column($out['nodes'], 'id')));

        $in = self::references("/api/snapshots/1/nodes/{$leaked}/references?direction=in");
        $fromStore = array_values(array_filter($in['edges'], static fn(array $e): bool => !$e['strong']));
        self::assertCount(1, $fromStore);
        self::assertMatchesRegularExpression('/^\d+$/', $fromStore[0]['name'], 'objects_store edges are named by handle');

        $capped = self::references("/api/snapshots/1/nodes/{$leaked}/references?direction=in&depth=8&limit=3");
        self::assertTrue($capped['truncated']);
        self::assertCount(3, $capped['nodes']);
    }

    public function testStringValuesAreMaskedUnlessRevealed(): void
    {
        $masked = self::nodes('/api/snapshots/1/search?q=' . rawurlencode('Product #42') . '&limit=1')[0];
        self::assertSame('StringContext = (hidden)', $masked['label']);
        $detail = self::detail("/api/snapshots/1/nodes/{$masked['id']}");
        self::assertNull($detail['stringValue']);
        self::assertSame('StringContext = (hidden)', $detail['label']);

        self::assertSame('Product #42', self::detail("/api/snapshots/1/nodes/{$masked['id']}?reveal=strings")['stringValue']);
        $revealed = self::nodes('/api/snapshots/1/search?q=' . rawurlencode('Product #42') . '&limit=1&reveal=strings')[0];
        self::assertSame('StringContext = "Product #42"', $revealed['label']);
    }

    public function testServesAllocationsAsBinary(): void
    {
        [$status, $headers, $body] = self::request('GET', '/api/snapshots/1/allocations');

        self::assertSame(200, $status);
        self::assertContains('content-type: application/octet-stream', $headers);
        // The format itself is covered by AllocationsPayloadTest; this checks it reaches the client whole.
        /** @var array{1: int} $headerLength */
        $headerLength = unpack('V', $body);
        /** @var array{count: int, columns: list<array{offset: int}>} $header */
        $header = json_decode(substr($body, 4, $headerLength[1]), true, flags: JSON_THROW_ON_ERROR);
        self::assertGreaterThan(1_000, $header['count']);
        $lastColumn = $header['columns'][count($header['columns']) - 1];
        self::assertGreaterThanOrEqual($lastColumn['offset'] + $header['count'], strlen($body));
    }

    public function testDiffsTwoOpenSnapshots(): void
    {
        /** @var array{handlesAvailable: bool, newObjects: list<int>, newObjectsByClass: list<array{class: string, count: int}>, growth: list<array{node: int, path: list<string>, delta: int}>} $diff */
        $diff = self::getJson('/api/diff?from=3&to=1');

        self::assertTrue($diff['handlesAvailable']);
        self::assertSame([['class' => 'Product', 'count' => 1_000]], $diff['newObjectsByClass']);
        self::assertCount(1_000, $diff['newObjects']);
        self::assertSame(['class_table', 'productcache', 'static_properties', 'items'], $diff['growth'][0]['path'] ?? null);
        self::assertSame(404, self::request('GET', '/api/diff?from=1&to=99')[0]);
        self::assertSame(400, self::request('GET', '/api/diff?from=x&to=1')[0]);
    }

    public function testRejectsForeignHostsAndBadRequests(): void
    {
        self::assertSame(403, self::request('GET', '/api/snapshots', ['Host: attacker.example'])[0]);
        self::assertSame(403, self::request('GET', '/api/snapshots', ['Host: 127.0.0.1.attacker.example:80'])[0]);
        self::assertSame(200, self::request('GET', '/api/snapshots', ['Host: localhost:8080'])[0], 'Docker may publish on another port');
        self::assertSame(404, self::request('GET', '/api/snapshots/99')[0]);
        self::assertSame(404, self::request('GET', '/api/snapshots/1/nodes/99999999')[0]);
        self::assertSame(404, self::request('GET', '/api/nope')[0]);
        self::assertSame(400, self::request('GET', '/api/snapshots/1/nodes/1/references?direction=sideways')[0]);
        self::assertSame(400, self::request('GET', '/api/snapshots/1/top-retained?limit=abc')[0]);
        self::assertSame(405, self::request('PUT', '/api/snapshots')[0]);
    }

    public function testUploadedSnapshotsLiveInTemporaryFilesUntilClosed(): void
    {
        $uploadDir = sys_get_temp_dir() . '/zendscape-' . self::$pid;

        [$status, , $body] = self::request('POST', '/api/snapshots', ['Content-Type: application/octet-stream', 'X-Filename: ../../listeners.t0.rmem'], (string) file_get_contents(self::FIXTURES . '/listeners.t0.rmem'));
        self::assertSame(201, $status);
        /** @var array{id: int, name: string} $created */
        $created = json_decode($body, true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('listeners.t0.rmem', $created['name']);
        self::assertCount(1, glob("{$uploadDir}/*.rmem") ?: []);

        self::assertSame(422, self::request('POST', '/api/snapshots', ['Content-Type: application/octet-stream'], 'not a snapshot')[0]);
        self::assertSame(415, self::request('POST', '/api/snapshots', ['Content-Type: text/plain'], (string) file_get_contents(self::FIXTURES . '/listeners.t0.rmem'))[0]);
        self::assertCount(1, glob("{$uploadDir}/*.rmem") ?: []);

        self::assertSame(204, self::request('DELETE', "/api/snapshots/{$created['id']}")[0]);
        self::assertSame([], glob("{$uploadDir}/*.rmem") ?: []);
        self::assertSame(404, self::request('GET', "/api/snapshots/{$created['id']}/classes")[0]);
    }

    /**
     * Response shapes are the API contract the frontend relies on.
     *
     * @return list<array{id: int, name: string, nodeCount: int, handlesAvailable: bool}>
     */
    private static function snapshots(): array
    {
        /** @var list<array{id: int, name: string, nodeCount: int, handlesAvailable: bool}> */
        return self::getJson('/api/snapshots');
    }

    /** @return list<array{id: int, type: string, label: string, shallowSize: int, retainedSize: int}> */
    private static function nodes(string $path): array
    {
        /** @var list<array{id: int, type: string, label: string, shallowSize: int, retainedSize: int}> */
        return self::getJson($path);
    }

    /** @return array{id: int, type: string, class: ?string, label: string, address: ?int, stringValue: ?string} */
    private static function detail(string $path): array
    {
        /** @var array{id: int, type: string, class: ?string, label: string, address: ?int, stringValue: ?string} */
        return self::getJson($path);
    }

    /** @return list<array{node: array{id: int}, linkName: string, strong: bool}> */
    private static function path(string $path): array
    {
        /** @var list<array{node: array{id: int}, linkName: string, strong: bool}> */
        return self::getJson($path);
    }

    /** @return list<list<array{node: array{id: int}, linkName: string, strong: bool}>> */
    private static function paths(string $path): array
    {
        /** @var list<list<array{node: array{id: int}, linkName: string, strong: bool}>> */
        return self::getJson($path);
    }

    /** @return array{nodes: list<array{id: int}>, edges: list<array{from: int, to: int, name: string, strong: bool}>, truncated: bool} */
    private static function references(string $path): array
    {
        /** @var array{nodes: list<array{id: int}>, edges: list<array{from: int, to: int, name: string, strong: bool}>, truncated: bool} */
        return self::getJson($path);
    }

    private static function getJson(string $path): mixed
    {
        [$status, , $body] = self::request('GET', $path);
        self::assertSame(200, $status, $body);

        return json_decode($body, true, flags: JSON_THROW_ON_ERROR);
    }

    /**
     * @param list<string> $headers
     * @return array{int, list<string>, string}
     */
    private static function request(string $method, string $path, array $headers = [], string $body = ''): array
    {
        $context = stream_context_create(['http' => ['method' => $method, 'header' => $headers, 'content' => $body, 'ignore_errors' => true]]);
        $response = (string) file_get_contents(self::$baseUrl . $path, false, $context);
        $responseHeaders = array_map(strtolower(...), http_get_last_response_headers() ?? []);
        preg_match('#^http/\S+ (\d{3})#', $responseHeaders[0] ?? '', $m);

        return [(int) ($m[1] ?? 0), $responseHeaders, $response];
    }
}
