<?php

declare(strict_types=1);

namespace Zendscape\Snapshot;

final readonly class NodeDetail
{
    public function __construct(
        public int $id,
        public string $type,
        public ?string $class,
        public string $label,
        public int $shallowSize,
        public int $retainedSize,
        public ?int $address,
        public ?int $refcount,
        public ?string $stringValue,
        public ?string $sourceLocation,
    ) {}
}
