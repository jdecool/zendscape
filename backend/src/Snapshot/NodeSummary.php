<?php

declare(strict_types=1);

namespace Zendscape\Snapshot;

final readonly class NodeSummary
{
    public function __construct(
        public int $id,
        public string $type,
        public string $label,
        public int $shallowSize,
        public int $retainedSize,
    ) {}
}
