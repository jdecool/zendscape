<?php

declare(strict_types=1);

namespace Zendscape\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Zendscape\Diff;
use Zendscape\Snapshot\Snapshot;

final class DiffTest extends TestCase
{
    /** @return iterable<string, array{string, string, int, list<string>}> */
    public static function leaks(): iterable
    {
        // scenario, leaking class, objects added between t0 and t1, path of the structure that grew
        yield 'static-cache' => ['static-cache', 'Product', 1_000, ['class_table', 'productcache', 'static_properties', 'items']];
        yield 'object-cycle' => ['object-cycle', 'TreeNode', 1_000, ['objects_store']];
        yield 'closure-this' => ['closure-this', 'OrderHandler', 200, ['class_table', 'retryregistry', 'static_properties', 'callbacks']];
        yield 'listeners' => ['listeners', 'AuditListener', 500, ['global_variables', 'array_elements', 'dispatcher', 'value', 'object_properties', 'listeners', 'array_elements', 'user.updated', 'value']];
    }

    /** @param list<string> $growingPath */
    #[DataProvider('leaks')]
    public function testReportsTheLeakFirst(string $scenario, string $class, int $added, array $growingPath): void
    {
        $before = Snapshot::open(__DIR__ . "/../../fixtures/{$scenario}.t0.rmem");
        $after = Snapshot::open(__DIR__ . "/../../fixtures/{$scenario}.t1.rmem");

        $diff = Diff::compute($before, $after);

        self::assertTrue($diff['handlesAvailable']);
        self::assertContains(['class' => $class, 'count' => $added], $diff['newObjectsByClass']);
        foreach ($diff['newObjects'] as $node) {
            self::assertNotNull($after->className($node));
        }
        self::assertSame($growingPath, $diff['growth'][0]['path'] ?? null);
        self::assertSame($after->findByPath($growingPath), $diff['growth'][0]['node']);
        self::assertGreaterThan(0, $diff['growth'][0]['delta']);

        $classRow = array_values(array_filter($diff['classes'], static fn(array $row): bool => $row['class'] === $class))[0] ?? null;
        self::assertNotNull($classRow);
        self::assertSame($added, $classRow['countAfter'] - $classRow['countBefore']);
    }

    public function testNoGrowthBetweenASnapshotAndItself(): void
    {
        $snapshot = Snapshot::open(__DIR__ . '/../../fixtures/listeners.t1.rmem');

        $diff = Diff::compute($snapshot, $snapshot);

        self::assertSame([], $diff['newObjects']);
        self::assertSame([], $diff['classes']);
        self::assertSame([], $diff['growth']);
    }
}
