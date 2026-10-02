<?php

declare(strict_types=1);

namespace Zendscape;

use Zendscape\Snapshot\NodeSummary;
use Zendscape\Snapshot\Reference;
use Zendscape\Snapshot\Snapshot;

/**
 * Bounded walks over a snapshot graph. Real heaps have hubs with hundreds of
 * thousands of edges (objects_store, big arrays), so every walk is capped.
 */
final class GraphWalk
{
    /**
     * Nodes reachable from $nodeId within $depth hops, following outgoing or
     * incoming references, breadth first.
     *
     * @return array{
     *     nodes: array<int, NodeSummary>,
     *     edges: list<array{from: int, to: int, name: string, strong: bool}>,
     *     truncated: bool,
     * }
     */
    public static function neighbourhood(Snapshot $snapshot, int $nodeId, bool $outgoing, int $depth, int $maxNodes): array
    {
        $nodes = [$nodeId => $snapshot->summary($nodeId)];
        $edges = [];
        $frontier = [$nodeId];
        $truncated = false;

        for ($level = 0; $level < $depth && $frontier !== []; $level++) {
            $next = [];
            foreach ($frontier as $current) {
                $references = $outgoing ? $snapshot->children($current) : $snapshot->parents($current);
                foreach ($references as $reference) {
                    $other = $reference->node->id;
                    if (!isset($nodes[$other])) {
                        if (count($nodes) >= $maxNodes) {
                            $truncated = true;
                            continue;
                        }
                        $nodes[$other] = $reference->node;
                        $next[] = $other;
                    }
                    [$from, $to] = $outgoing ? [$current, $other] : [$other, $current];
                    $edges[] = ['from' => $from, 'to' => $to, 'name' => $reference->linkName, 'strong' => $reference->strong];
                }
            }
            $frontier = $next;
        }

        return ['nodes' => $nodes, 'edges' => $edges, 'truncated' => $truncated];
    }

    /**
     * Shortest distinct chains of strong references from a root down to
     * $nodeId, each listed leaf first like Snapshot::pathToRoot(). Weak edges
     * (objects_store) are skipped because they do not keep anything alive:
     * an empty result means the node is garbage awaiting collection.
     *
     * @return list<list<Reference>>
     */
    public static function retentionPaths(Snapshot $snapshot, int $nodeId, int $maxPaths, int $maxDepth): array
    {
        $roots = array_flip($snapshot->roots());
        $start = new Reference($snapshot->summary($nodeId), '', true);
        /** @var list<list<Reference>> $queue */
        $queue = [[$start]];
        $paths = [];
        // ponytail: bounded BFS over simple paths, exponential on dense graphs without the cap; switch to k-shortest paths if caps bite.
        $budget = 10_000;

        while ($queue !== [] && count($paths) < $maxPaths && $budget-- > 0) {
            $path = array_shift($queue);
            $head = $path[count($path) - 1]->node->id;

            if (isset($roots[$head])) {
                $paths[] = $path;
                continue;
            }
            if (count($path) > $maxDepth) {
                continue;
            }

            $onPath = array_flip(array_map(static fn(Reference $step): int => $step->node->id, $path));
            foreach ($snapshot->parents($head) as $parent) {
                if ($parent->strong && !isset($onPath[$parent->node->id])) {
                    $queue[] = [...$path, $parent];
                }
            }
        }

        return array_map(static fn(array $path): array => self::linkNamesOntoChildren($snapshot, $path), $paths);
    }

    /**
     * Walking parents yields each edge name on the parent step; paths are
     * read like pathToRoot(), where a step carries the name of the edge into
     * it and the root carries its own name (class_table, global_variables...).
     *
     * @param list<Reference> $path
     * @return list<Reference>
     */
    private static function linkNamesOntoChildren(Snapshot $snapshot, array $path): array
    {
        $shifted = [];
        foreach ($path as $i => $step) {
            $linkName = isset($path[$i + 1])
                ? $path[$i + 1]->linkName
                : ($snapshot->pathToRoot($step->node->id)[0]->linkName ?? '');
            $shifted[] = new Reference($step->node, $linkName, true);
        }

        return $shifted;
    }
}
