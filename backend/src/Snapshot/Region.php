<?php

declare(strict_types=1);

namespace Zendscape\Snapshot;

/**
 * Memory region of an allocation, as classified by reli. VM stacks and
 * compiler arenas are carved out of ZendMM chunks, so they share the chunk
 * and page geometry of the heap.
 */
enum Region: string
{
    case Heap = 'zend_mm_heap';
    case Huge = 'zend_mm_huge';
    case VmStack = 'vm_stack';
    case CompilerArena = 'compiler_arena';
    case Outside = 'outside';

    public function isInChunk(): bool
    {
        return match ($this) {
            self::Heap, self::VmStack, self::CompilerArena => true,
            self::Huge, self::Outside => false,
        };
    }
}
