<?php

declare(strict_types=1);

namespace Zendscape\Snapshot;

final readonly class ClassUsage
{
    public function __construct(
        public string $class,
        public int $count,
        public int $totalShallowSize,
    ) {}
}
