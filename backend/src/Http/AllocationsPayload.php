<?php

declare(strict_types=1);

namespace Zendscape\Http;

use Zendscape\Snapshot\Allocation;
use Zendscape\Snapshot\Region;
use Zendscape\Snapshot\Snapshot;

/**
 * Columnar binary encoding of every allocation the scene places (ADR 0005).
 *
 * Layout, all integers little-endian:
 *
 *   u32       H, byte length of the header
 *   H bytes   header, UTF-8 JSON:
 *               count    number of allocations (N)
 *               blocks   [{base: "0x...", kind: "chunk"|"huge", size: int}], sorted by base
 *               classes  class names, indexed by the class column
 *               types    node types, indexed by the type column
 *               regions  region names, indexed by the region column
 *               columns  [{name, type: "u32"|"u16"|"u8", offset}], offset from the payload start
 *   columns   N elements each, every column starting on a 4-byte boundary:
 *               block   u32  index into blocks
 *               offset  u32  byte offset of the allocation inside its block
 *               size    u32  allocation size in bytes
 *               node    u32  owning node id
 *               class   u32  index into classes, 0xFFFFFFFF when the node has no class
 *               type    u16  index into types
 *               region  u8   index into regions
 *
 * Addresses are 64-bit, beyond what JavaScript numbers hold exactly, so they
 * only travel as hex strings for blocks; allocations are block-relative.
 * Allocations outside ZendMM are left out (ADR 0004).
 */
final class AllocationsPayload
{
    public const int NO_CLASS = 0xFFFF_FFFF;

    public static function encode(Snapshot $snapshot): string
    {
        $allocations = [];
        /** @var array<int, array{base: string, kind: string, size: int}> $blocks */
        $blocks = [];
        foreach ($snapshot->allocations() as $allocation) {
            $base = self::blockBase($allocation);
            if ($base === null) {
                continue;
            }
            $allocations[] = $allocation;
            $blocks[$base] ??= $allocation->region === Region::Huge
                ? ['base' => sprintf('0x%x', $base), 'kind' => 'huge', 'size' => $allocation->size]
                : ['base' => sprintf('0x%x', $base), 'kind' => 'chunk', 'size' => Allocation::CHUNK_SIZE];
        }
        ksort($blocks);
        $blockIndex = array_flip(array_keys($blocks));

        $regions = array_map(static fn(Region $region): string => $region->value, Region::cases());
        $regionIndex = array_flip($regions);
        $classes = [];
        $types = [];
        $columns = ['block' => [], 'offset' => [], 'size' => [], 'node' => [], 'class' => [], 'type' => [], 'region' => []];

        foreach ($allocations as $allocation) {
            $base = (int) self::blockBase($allocation);
            $class = $snapshot->className($allocation->nodeId);
            $type = $snapshot->nodeType($allocation->nodeId);

            $columns['block'][] = $blockIndex[$base];
            $columns['offset'][] = $allocation->address - $base;
            $columns['size'][] = $allocation->size;
            $columns['node'][] = $allocation->nodeId;
            $columns['class'][] = $class === null ? self::NO_CLASS : ($classes[$class] ??= count($classes));
            $columns['type'][] = $types[$type] ??= count($types);
            $columns['region'][] = $regionIndex[$allocation->region->value];
        }

        $formats = ['block' => 'u32', 'offset' => 'u32', 'size' => 'u32', 'node' => 'u32', 'class' => 'u32', 'type' => 'u16', 'region' => 'u8'];
        $packCodes = ['u32' => 'V*', 'u16' => 'v*', 'u8' => 'C*'];
        $packed = array_map(
            static fn(string $name): string => pack($packCodes[$formats[$name]], ...$columns[$name]),
            array_combine(array_keys($columns), array_keys($columns)),
        );

        $header = [
            'count' => count($allocations),
            'blocks' => array_values($blocks),
            'classes' => array_keys($classes),
            'types' => array_map(strval(...), array_keys($types)),
            'regions' => $regions,
            'columns' => [],
        ];

        // Column offsets depend on the header length, which depends on the offsets: reserve
        // a fixed-width placeholder per offset so the header length does not change.
        foreach ($formats as $name => $format) {
            $header['columns'][] = ['name' => $name, 'type' => $format, 'offset' => 1_000_000_000_000];
        }
        $headerLength = strlen(self::json($header));
        $offset = self::align(4 + $headerLength);
        foreach ($header['columns'] as $i => $column) {
            $header['columns'][$i]['offset'] = $offset;
            $offset = self::align($offset + strlen($packed[$column['name']]));
        }

        $json = str_pad(self::json($header), $headerLength);
        $body = pack('V', $headerLength) . $json;
        foreach ($packed as $bytes) {
            $body = str_pad($body, self::align(strlen($body)), "\0") . $bytes;
        }

        return $body;
    }

    private static function blockBase(Allocation $allocation): ?int
    {
        return $allocation->region === Region::Huge ? $allocation->address : $allocation->chunkBase();
    }

    private static function align(int $length): int
    {
        return ($length + 3) & ~3;
    }

    /** @param array<string, mixed> $value */
    private static function json(array $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    }
}
