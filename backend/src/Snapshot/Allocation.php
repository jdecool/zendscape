<?php

declare(strict_types=1);

namespace Zendscape\Snapshot;

/**
 * One memory block owned by a node. A node may own several (an object and
 * its property table), and the scene places blocks, not nodes (ADR 0004).
 */
final readonly class Allocation
{
    public const int CHUNK_SIZE = 2 * 1024 * 1024;
    public const int PAGE_SIZE = 4 * 1024;

    public function __construct(
        public int $nodeId,
        public int $address,
        public int $size,
        public Region $region,
    ) {}

    /** Base address of the ZendMM chunk holding this block, null outside chunks. */
    public function chunkBase(): ?int
    {
        return $this->region->isInChunk() ? $this->address & ~(self::CHUNK_SIZE - 1) : null;
    }

    /** Index of the first page (0-511) within its chunk, null outside chunks. */
    public function page(): ?int
    {
        return $this->region->isInChunk() ? ($this->address & (self::CHUNK_SIZE - 1)) >> 12 : null;
    }

    public function offsetInPage(): int
    {
        return $this->address & (self::PAGE_SIZE - 1);
    }

    /** Number of pages the block touches, at least one. */
    public function pageSpan(): int
    {
        $end = $this->offsetInPage() + max($this->size, 1);

        return intdiv($end + self::PAGE_SIZE - 1, self::PAGE_SIZE);
    }
}
