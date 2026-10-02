<?php

declare(strict_types=1);

namespace Zendscape\Tests\Snapshot;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Zendscape\Snapshot\Allocation;
use Zendscape\Snapshot\Reference;
use Zendscape\Snapshot\Region;
use Zendscape\Snapshot\Snapshot;

/**
 * Contract tests of the reli adapter against the reference fixtures
 * (ADR 0008): each leak must be findable through Snapshot alone.
 */
final class SnapshotTest extends TestCase
{
    /** @var array<string, Snapshot> */
    private static array $snapshots = [];

    /** @return iterable<string, array{string, string, int, int, list<string>}> */
    public static function leaks(): iterable
    {
        // scenario, leaking class, count at t0, count at t1, links on its path to root (leaf first)
        yield 'static-cache' => ['static-cache', 'Product', 100, 1_100, ['items', 'static_properties', 'class_table']];
        yield 'object-cycle' => ['object-cycle', 'TreeNode', 100, 1_100, ['objects_store']];
        yield 'closure-this' => ['closure-this', 'OrderHandler', 20, 220, ['this_ptr', 'callbacks', 'class_table']];
        yield 'listeners' => ['listeners', 'AuditListener', 50, 550, ['user.updated', 'listeners', 'global_variables']];
    }

    /** @return iterable<string, array{string, string}> */
    public static function leakingClasses(): iterable
    {
        foreach (self::leaks() as $name => [$scenario, $class]) {
            yield $name => [$scenario, $class];
        }
    }

    /** @return iterable<string, array{string, string, int, int}> */
    public static function leakCounts(): iterable
    {
        foreach (self::leaks() as $name => [$scenario, $class, $t0, $t1]) {
            yield $name => [$scenario, $class, $t0, $t1];
        }
    }

    #[DataProvider('leakCounts')]
    public function testClassRankingCountsLeakingInstances(string $scenario, string $class, int $t0, int $t1): void
    {
        self::assertSame($t0, self::instancesOf(self::snapshot($scenario, 't0'), $class));
        self::assertSame($t1, self::instancesOf(self::snapshot($scenario, 't1'), $class));
    }

    #[DataProvider('leakCounts')]
    public function testNewHandlesBetweenSnapshotsAreTheLeak(string $scenario, string $class, int $t0, int $t1): void
    {
        $before = self::snapshot($scenario, 't0')->objectHandles();
        $after = self::snapshot($scenario, 't1');
        $afterHandles = $after->objectHandles();
        self::assertNotNull($before);
        self::assertNotNull($afterHandles);

        $newByClass = array_count_values(array_map(
            static fn(int $nodeId): string => $after->className($nodeId) ?? '?',
            array_values(array_diff_key($afterHandles, $before)),
        ));
        arsort($newByClass);

        self::assertSame($class, array_key_first($newByClass));
        self::assertSame($t1 - $t0, $newByClass[$class]);
    }

    /** @param list<string> $expectedLinks */
    #[DataProvider('leaks')]
    public function testPathToRootExplainsRetention(string $scenario, string $class, int $t0, int $t1, array $expectedLinks): void
    {
        $snapshot = self::snapshot($scenario, 't1');
        $leaked = $snapshot->nodesOfClass($class)[0]->id;

        $path = $snapshot->pathToRoot($leaked);
        $links = array_map(static fn(Reference $step): string => $step->linkName, $path);

        self::assertSame($leaked, $path[0]->node->id);
        self::assertSame($expectedLinks, array_values(array_intersect($links, $expectedLinks)));
        self::assertSame(end($expectedLinks), end($links));
    }

    #[DataProvider('leakingClasses')]
    public function testIncomingReferencesCarryObjectHandle(string $scenario, string $class): void
    {
        $snapshot = self::snapshot($scenario, 't1');
        $handles = $snapshot->objectHandles();
        self::assertNotNull($handles);
        $leaked = $snapshot->nodesOfClass($class)[0]->id;

        $fromObjectsStore = array_filter(
            $snapshot->parents($leaked),
            static fn(Reference $parent): bool => $parent->node->label === 'ObjectsStoreContext',
        );

        self::assertCount(1, $fromObjectsStore);
        $reference = array_values($fromObjectsStore)[0];
        self::assertSame($leaked, $handles[(int) $reference->linkName]);
        self::assertFalse($reference->strong, 'objects_store does not retain objects');
    }

    #[DataProvider('leakingClasses')]
    public function testOutgoingReferencesAreNamed(string $scenario, string $class): void
    {
        $snapshot = self::snapshot($scenario, 't1');
        $leaked = $snapshot->nodesOfClass($class)[0]->id;

        $children = $snapshot->children($leaked);

        self::assertNotEmpty($children);
        foreach ($children as $child) {
            self::assertNotSame('', $child->linkName);
            self::assertContains($leaked, array_map(
                static fn(Reference $parent): int => $parent->node->id,
                $snapshot->parents($child->node->id),
            ));
        }
    }

    #[DataProvider('leakingClasses')]
    public function testLeakedObjectIsPlacedInTheHeapAtItsAddress(string $scenario, string $class): void
    {
        $snapshot = self::snapshot($scenario, 't1');
        $leaked = $snapshot->nodesOfClass($class)[0]->id;
        $detail = $snapshot->detail($leaked);

        self::assertSame($class, $detail->class);
        self::assertNotNull($detail->address);
        self::assertSame($leaked, $snapshot->findByAddress($detail->address));

        $owned = array_filter(
            iterator_to_array($snapshot->allocations(), false),
            static fn(Allocation $allocation): bool => $allocation->nodeId === $leaked,
        );
        self::assertContains($detail->address, array_map(static fn(Allocation $a): int => $a->address, $owned));
        foreach ($owned as $allocation) {
            self::assertSame(Region::Heap, $allocation->region);
        }
    }

    public function testEveryChunkAllocationFitsInItsChunk(): void
    {
        $count = 0;
        foreach (self::snapshot('static-cache', 't1')->allocations() as $allocation) {
            if ($allocation->region->isInChunk()) {
                $count++;
                self::assertSame(0, ($allocation->chunkBase() ?? -1) % Allocation::CHUNK_SIZE);
                self::assertLessThanOrEqual(512, ($allocation->page() ?? -1) + $allocation->pageSpan());
            }
        }
        self::assertGreaterThan(1_000, $count);
    }

    public function testSearchFindsStringValues(): void
    {
        $snapshot = self::snapshot('listeners', 't1');

        $labels = array_map(static fn($node): string => $node->label, $snapshot->search('req-42', 10));

        self::assertNotEmpty(array_filter($labels, static fn(string $label): bool => str_contains($label, 'req-42')));
    }

    private static function instancesOf(Snapshot $snapshot, string $class): ?int
    {
        foreach ($snapshot->classRanking() as $usage) {
            if ($usage->class === $class) {
                return $usage->count;
            }
        }

        return null;
    }

    private static function snapshot(string $scenario, string $phase): Snapshot
    {
        return self::$snapshots["{$scenario}.{$phase}"] ??= Snapshot::open(__DIR__ . "/../../../fixtures/{$scenario}.{$phase}.rmem");
    }
}
