<?php

declare(strict_types=1);

namespace Zendscape\Tests\Snapshot;

use PHPUnit\Framework\TestCase;
use Zendscape\Snapshot\Allocation;
use Zendscape\Snapshot\Region;

final class AllocationTest extends TestCase
{
    private const int CHUNK = 0x7F00_0020_0000;

    public function testSmallBlockSitsInOnePageOfItsChunk(): void
    {
        $allocation = new Allocation(1, self::CHUNK + 3 * 4096 + 0x10, 56, Region::Heap);

        self::assertSame(self::CHUNK, $allocation->chunkBase());
        self::assertSame(3, $allocation->page());
        self::assertSame(0x10, $allocation->offsetInPage());
        self::assertSame(1, $allocation->pageSpan());
    }

    public function testLastPageOfChunk(): void
    {
        $allocation = new Allocation(1, self::CHUNK + Allocation::CHUNK_SIZE - 4096, 4096, Region::Heap);

        self::assertSame(self::CHUNK, $allocation->chunkBase());
        self::assertSame(511, $allocation->page());
        self::assertSame(1, $allocation->pageSpan());
    }

    public function testBlockCrossingPageBoundariesSpansEveryTouchedPage(): void
    {
        self::assertSame(2, new Allocation(1, self::CHUNK + 4000, 200, Region::Heap)->pageSpan());
        self::assertSame(3, new Allocation(1, self::CHUNK, 3 * 4096, Region::Heap)->pageSpan());
        self::assertSame(1, new Allocation(1, self::CHUNK, 0, Region::Heap)->pageSpan());
    }

    public function testVmStackAndCompilerArenaLiveInChunks(): void
    {
        self::assertSame(self::CHUNK, new Allocation(1, self::CHUNK + 8192, 64, Region::VmStack)->chunkBase());
        self::assertSame(2, new Allocation(1, self::CHUNK + 8192, 64, Region::CompilerArena)->page());
    }

    public function testHugeAndOutsideBlocksHaveNoChunkGeometry(): void
    {
        foreach ([Region::Huge, Region::Outside] as $region) {
            $allocation = new Allocation(1, self::CHUNK, 3 * 1024 * 1024, $region);
            self::assertNull($allocation->chunkBase());
            self::assertNull($allocation->page());
        }
    }
}
