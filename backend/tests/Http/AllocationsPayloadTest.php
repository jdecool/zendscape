<?php

declare(strict_types=1);

namespace Zendscape\Tests\Http;

use PHPUnit\Framework\TestCase;
use Zendscape\Http\AllocationsPayload;
use Zendscape\Snapshot\Allocation;
use Zendscape\Snapshot\Snapshot;

final class AllocationsPayloadTest extends TestCase
{
    public function testDecodesBackToTheSnapshotAllocations(): void
    {
        $snapshot = Snapshot::open(__DIR__ . '/../../../fixtures/static-cache.t1.rmem');
        $payload = AllocationsPayload::encode($snapshot);

        $headerLength = self::u32($payload, 0);
        /** @var array{count: int, blocks: list<array{base: string, kind: string, size: int}>, classes: list<string>, types: list<string>, regions: list<string>, columns: list<array{name: string, type: 'u32'|'u16'|'u8', offset: int}>} $header */
        $header = json_decode(substr($payload, 4, $headerLength), true, flags: JSON_THROW_ON_ERROR);
        $count = $header['count'];

        $columns = [];
        foreach ($header['columns'] as $column) {
            self::assertSame(0, $column['offset'] % 4, "{$column['name']} is 4-byte aligned");
            $size = ['u32' => 4, 'u16' => 2, 'u8' => 1][$column['type']];
            $codes = ['u32' => 'V', 'u16' => 'v', 'u8' => 'C'];
            /** @var array<int, int> $values */
            $values = unpack("{$codes[$column['type']]}{$count}", substr($payload, $column['offset'], $count * $size));
            $columns[$column['name']] = array_values($values);
        }

        $expected = array_values(array_filter(
            iterator_to_array($snapshot->allocations(), false),
            static fn(Allocation $a): bool => $a->region->isInChunk() || $a->region->value === 'zend_mm_huge',
        ));
        self::assertSame(count($expected), $count);

        foreach ($expected as $i => $allocation) {
            $block = $header['blocks'][$columns['block'][$i]];
            self::assertSame(sprintf('0x%x', $allocation->address - $columns['offset'][$i]), $block['base']);
            self::assertLessThan($block['size'], $columns['offset'][$i]);
            self::assertSame($allocation->size, $columns['size'][$i]);
            self::assertSame($allocation->nodeId, $columns['node'][$i]);
            self::assertSame($snapshot->nodeType($allocation->nodeId), $header['types'][$columns['type'][$i]]);
            self::assertSame($allocation->region->value, $header['regions'][$columns['region'][$i]]);
            $class = $snapshot->className($allocation->nodeId);
            self::assertSame($class, $class === null ? null : $header['classes'][$columns['class'][$i]]);
        }
        self::assertContains('Product', $header['classes']);
    }

    private static function u32(string $bytes, int $offset): int
    {
        $value = unpack('V', $bytes, $offset);

        return is_array($value) && is_int($value[1]) ? $value[1] : throw new \UnexpectedValueException('Truncated payload');
    }
}
