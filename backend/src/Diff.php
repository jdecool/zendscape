<?php

declare(strict_types=1);

namespace Zendscape;

use Zendscape\Snapshot\Snapshot;

/**
 * What changed between two snapshots of the same process (ADR 0006).
 *
 * Objects are matched by (handle, class). Arrays and strings have no
 * identity, so growth is measured on structures found at the same path
 * from the roots in both snapshots.
 */
final class Diff
{
    /** Node types that are structures a developer can name and fix. */
    private const array STRUCTURE_TYPES = ['ArrayHeaderContext', 'ObjectContext', 'ObjectsStoreContext'];

    /** A parent is only reported when no single child explains this share of its growth. */
    private const float EXPLAINED_SHARE = 0.8;

    /**
     * @return array{
     *     handlesAvailable: bool,
     *     newObjects: list<int>,
     *     newObjectsByClass: list<array{class: string, count: int}>,
     *     classes: list<array{class: string, countBefore: int, countAfter: int, bytesBefore: int, bytesAfter: int}>,
     *     growth: list<array{node: int, path: list<string>, before: int, after: int, delta: int}>,
     * }
     */
    public static function compute(Snapshot $before, Snapshot $after, int $maxNewObjects = 200_000): array
    {
        $handlesBefore = $before->objectHandles();
        $handlesAfter = $after->objectHandles();
        $available = $handlesBefore !== null && $handlesAfter !== null;

        $newObjects = [];
        $newByClass = [];
        if ($available) {
            foreach ($handlesAfter as $handle => $node) {
                $class = $after->className($node);
                $previous = $handlesBefore[$handle] ?? null;
                // A freed handle reused by another class is a new object, not a survivor.
                if ($previous === null || $before->className($previous) !== $class) {
                    $newByClass[$class ?? '?'] = ($newByClass[$class ?? '?'] ?? 0) + 1;
                    if (count($newObjects) < $maxNewObjects) {
                        $newObjects[] = $node;
                    }
                }
            }
            arsort($newByClass);
        }

        return [
            'handlesAvailable' => $available,
            'newObjects' => $newObjects,
            'newObjectsByClass' => array_map(
                static fn(string $class, int $count): array => ['class' => $class, 'count' => $count],
                array_keys($newByClass),
                array_values($newByClass),
            ),
            'classes' => self::classes($before, $after),
            'growth' => self::growth($before, $after),
        ];
    }

    /** @return list<array{class: string, countBefore: int, countAfter: int, bytesBefore: int, bytesAfter: int}> */
    private static function classes(Snapshot $before, Snapshot $after): array
    {
        $rows = [];
        foreach ([[$before, 'Before'], [$after, 'After']] as [$snapshot, $side]) {
            foreach ($snapshot->classRanking() as $usage) {
                $rows[$usage->class] ??= ['class' => $usage->class, 'countBefore' => 0, 'countAfter' => 0, 'bytesBefore' => 0, 'bytesAfter' => 0];
                $rows[$usage->class]["count{$side}"] = $usage->count;
                $rows[$usage->class]["bytes{$side}"] = $usage->totalShallowSize;
            }
        }
        $changed = array_filter($rows, static fn(array $r): bool => $r['countBefore'] !== $r['countAfter'] || $r['bytesBefore'] !== $r['bytesAfter']);
        usort($changed, static fn(array $a, array $b): int => ($b['bytesAfter'] - $b['bytesBefore']) <=> ($a['bytesAfter'] - $a['bytesBefore']));

        return $changed;
    }

    /** @return list<array{node: int, path: list<string>, before: int, after: int, delta: int}> */
    private static function growth(Snapshot $before, Snapshot $after): array
    {
        // ponytail: only the largest structures of the later snapshot are candidates; a leak small enough to miss this is not the one hurting.
        $candidates = [];
        foreach ($after->topRetained(500) as $node) {
            if (!in_array($node->type, self::STRUCTURE_TYPES, true)) {
                continue;
            }
            $path = array_reverse(array_map(static fn($step): string => $step->linkName, $after->pathToRoot($node->id)));
            $previous = $before->findByPath($path);
            $sizeBefore = $previous === null ? 0 : $before->summary($previous)->retainedSize;
            $delta = $node->retainedSize - $sizeBefore;
            if ($delta > 0) {
                $candidates[] = ['node' => $node->id, 'path' => $path, 'before' => $sizeBefore, 'after' => $node->retainedSize, 'delta' => $delta];
            }
        }

        // Report the most specific structure explaining the growth: drop a parent
        // when one child accounts for most of it...
        $specific = array_values(array_filter($candidates, static function (array $parent) use ($candidates): bool {
            foreach ($candidates as $child) {
                if (self::isDescendant($child['path'], $parent['path']) && $child['delta'] >= self::EXPLAINED_SHARE * $parent['delta']) {
                    return false;
                }
            }

            return true;
        }));
        // ...then drop what is already counted in a reported structure, such as each new element of a growing array.
        $growth = array_values(array_filter($specific, static function (array $child) use ($specific): bool {
            foreach ($specific as $parent) {
                if (self::isDescendant($child['path'], $parent['path'])) {
                    return false;
                }
            }

            return true;
        }));
        usort($growth, static fn(array $a, array $b): int => $b['delta'] <=> $a['delta']);

        return $growth;
    }

    /**
     * @param list<string> $path
     * @param list<string> $ancestor
     */
    private static function isDescendant(array $path, array $ancestor): bool
    {
        return count($path) > count($ancestor) && array_slice($path, 0, count($ancestor)) === $ancestor;
    }
}
