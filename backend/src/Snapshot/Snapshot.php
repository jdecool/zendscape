<?php

declare(strict_types=1);

namespace Zendscape\Snapshot;

use Reli\Inspector\Output\MemoryOutput\BinaryFormat\Format;
use Reli\Inspector\Output\MemoryOutput\BinaryFormat\Reader;
use Reli\Inspector\Output\MemoryOutput\Report\Substrate\GraphSubstrate;
use Reli\Rmem\Explore\RmemModel;

/**
 * A loaded .rmem memory snapshot.
 *
 * This is the reli adapter (ADR 0001): the only class allowed to touch reli.
 * Everything it returns is a Zendscape type, so a reli upgrade can only
 * break this file. reli classes are instantiated directly because booting
 * reli's container loads Linux-only libraries (docs/spike-0.md).
 */
final class Snapshot
{
    /**
     * Non-tree edges keyed by edgeKey(), valued by (link name id << 1 | strong).
     * reli's substrate keeps no names for these edges, yet they carry object
     * handles and real property names.
     *
     * @var array<int, int>|null
     */
    private ?array $nonTreeEdges = null;

    /** @var array<int, int>|null handle => node id, built with $nonTreeEdges */
    private ?array $handles = null;

    private function __construct(
        public readonly string $path,
        private readonly Reader $reader,
        private readonly GraphSubstrate $substrate,
        private readonly RmemModel $model,
    ) {}

    public static function open(string $path): self
    {
        $reader = Reader::open($path);
        // SCC detection is only needed for cycle analysis and costs a third of the load time.
        $substrate = GraphSubstrate::createFromBinary($reader, skipScc: true);

        return new self($path, $reader, $substrate, RmemModel::fromSubstrate($substrate, $reader));
    }

    public function nodeCount(): int
    {
        return $this->substrate->getNodeCount();
    }

    public function summary(int $nodeId): NodeSummary
    {
        return new NodeSummary(
            $nodeId,
            $this->model->nodeLabel($nodeId),
            $this->substrate->getNodeSize($nodeId),
            $this->substrate->getSubtreeSize($nodeId),
        );
    }

    /** Cheap class lookup, without loading the per-node location details. */
    public function className(int $nodeId): ?string
    {
        return $this->substrate->getNodeClass($nodeId);
    }

    public function detail(int $nodeId): NodeDetail
    {
        $detail = $this->model->nodeDetail($nodeId);

        return new NodeDetail(
            $nodeId,
            $detail['type'],
            $detail['class'],
            $this->model->nodeLabel($nodeId),
            $detail['shallow'],
            $detail['retained'],
            $detail['address'],
            $detail['refcount'],
            $detail['string_value'],
            $detail['source_location'],
        );
    }

    /** @return list<Reference> outgoing edges */
    public function children(int $nodeId): array
    {
        return $this->references($nodeId, $this->substrate->getAllChildren($nodeId), outgoing: true);
    }

    /** @return list<Reference> incoming edges */
    public function parents(int $nodeId): array
    {
        return $this->references($nodeId, $this->substrate->getAllParents($nodeId), outgoing: false);
    }

    /**
     * Ownership chain from the node up to its root, following the spanning
     * tree reli computed. Each step's link name is the edge into that step.
     *
     * @return list<Reference>
     */
    public function pathToRoot(int $nodeId): array
    {
        return array_map(
            fn(array $step): Reference => new Reference($this->summary($step['node_id']), $step['link_name'], true),
            $this->model->pathToRoot($nodeId),
        );
    }

    /** @return list<ClassUsage> classes ranked by total shallow size */
    public function classRanking(): array
    {
        return array_map(
            static fn(array $row): ClassUsage => new ClassUsage($row['class'], $row['count'], $row['total_shallow']),
            $this->model->getClassRanking(),
        );
    }

    /** @return list<NodeSummary> */
    public function topRetained(int $limit): array
    {
        return $this->summaries($this->model->getTopRetained($limit));
    }

    /** @return list<NodeSummary> instances of the class, largest retained first */
    public function nodesOfClass(string $class): array
    {
        return $this->summaries($this->model->getNodesByClass($class));
    }

    /** @return list<NodeSummary> nodes whose label, class or string value matches */
    public function search(string $pattern, int $limit): array
    {
        return $this->summaries($this->model->globalSearch($pattern, $limit));
    }

    public function findByAddress(int $address): ?int
    {
        return $this->model->findNodeByAddress($address);
    }

    /** @return iterable<Allocation> */
    public function allocations(): iterable
    {
        $count = $this->reader->getSectionElementCount(Format::SECTION_LOCATIONS);
        $rows = $this->reader->castSection(Format::SECTION_LOCATIONS, 'LocationRow');
        if ($rows === null) {
            return;
        }
        $dict = $this->reader->getStringDict();
        /** @var array<int, Region> $regions */
        $regions = [];

        for ($i = 0; $i < $count; $i++) {
            /** @var object{node_id: int, address: int, size: int, region_id: int} $row */
            $row = $rows[$i];
            if ($row->address === 0) {
                continue;
            }
            $regions[$row->region_id] ??= Region::from((string) $dict->lookup($row->region_id));

            yield new Allocation($row->node_id, $row->address, $row->size, $regions[$row->region_id]);
        }
    }

    /**
     * Object handle => node id, the identity used to diff snapshots
     * (ADR 0006). Null when the snapshot has no objects_store edges, which
     * reli 0.12.0 intermittently produces (docs/spike-0.md).
     *
     * @return array<int, int>|null
     */
    public function objectHandles(): ?array
    {
        $this->indexEdges();

        return $this->handles === [] ? null : $this->handles;
    }

    /**
     * @param list<int> $otherEnds
     * @return list<Reference>
     */
    private function references(int $nodeId, array $otherEnds, bool $outgoing): array
    {
        $this->indexEdges();
        $dict = $this->reader->getStringDict();
        $references = [];

        foreach ($otherEnds as $other) {
            [$parent, $child] = $outgoing ? [$nodeId, $other] : [$other, $nodeId];
            $edge = $this->nonTreeEdges[$this->edgeKey($parent, $child)] ?? null;

            $references[] = $edge === null
                ? new Reference(
                    $this->summary($other),
                    $this->substrate->getTreeLinkName($child) ?? '',
                    in_array($child, $this->substrate->getStrongChildren($parent), true),
                )
                : new Reference($this->summary($other), (string) $dict->lookup($edge >> 1), ($edge & 1) === 1);
        }

        return $references;
    }

    private function indexEdges(): void
    {
        if ($this->nonTreeEdges !== null) {
            return;
        }

        $objectsStore = null;
        foreach ($this->substrate->getRoots() as $root) {
            if ($this->substrate->getTreeLinkName($root) === 'objects_store') {
                $objectsStore = $root;
            }
        }

        $count = $this->reader->getSectionElementCount(Format::SECTION_EDGES);
        $rows = $this->reader->castSection(Format::SECTION_EDGES, 'EdgeRow');
        $dict = $this->reader->getStringDict();
        $this->nonTreeEdges = [];
        $this->handles = [];

        for ($i = 0; $rows !== null && $i < $count; $i++) {
            /** @var object{parent_node_id: int, child_node_id: int, link_name_id: int, is_tree: int, strength: int} $row */
            $row = $rows[$i];
            // Objects only reachable through objects_store (garbage cycles) get it as their tree parent.
            if ($row->parent_node_id === $objectsStore) {
                $this->handles[(int) $dict->lookup($row->link_name_id)] = $row->child_node_id;
            }
            if ($row->is_tree === 0) {
                $strong = $row->strength === 0 ? 1 : 0;
                $this->nonTreeEdges[$this->edgeKey($row->parent_node_id, $row->child_node_id)] = $row->link_name_id << 1 | $strong;
            }
        }
    }

    /**
     * PHP hashes integer keys by their low bits, so packing the pair as
     * (parent << 32 | child) collides massively: indexing 1M edges took 86s
     * instead of 0.2s on a 2.7M-node snapshot.
     */
    private function edgeKey(int $parent, int $child): int
    {
        return $parent * $this->substrate->getNodeCount() + $child;
    }

    /**
     * @param list<array{node_id: int, ...}> $rows
     * @return list<NodeSummary>
     */
    private function summaries(array $rows): array
    {
        return array_map(fn(array $row): NodeSummary => $this->summary($row['node_id']), $rows);
    }
}
