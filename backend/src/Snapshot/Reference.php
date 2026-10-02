<?php

declare(strict_types=1);

namespace Zendscape\Snapshot;

/**
 * An edge seen from one of its ends: $node is the other end, $linkName the
 * name of the edge (property, array key, object handle...).
 */
final readonly class Reference
{
    public function __construct(
        public NodeSummary $node,
        public string $linkName,
        public bool $strong,
    ) {}
}
