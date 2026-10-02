<?php

declare(strict_types=1);

namespace Zendscape;

use Zendscape\Snapshot\Snapshot;

/**
 * Ordered snapshots explored together (ADR 0002). Order is capture order,
 * which is what a diff between two snapshots relies on.
 */
final class Session
{
    /** @var list<Snapshot> */
    private array $snapshots = [];

    public function add(Snapshot $snapshot): int
    {
        $this->snapshots[] = $snapshot;

        return array_key_last($this->snapshots);
    }

    public function snapshot(int $index): Snapshot
    {
        return $this->snapshots[$index] ?? throw new \OutOfRangeException("No snapshot #{$index} in session");
    }

    /** @return list<Snapshot> */
    public function snapshots(): array
    {
        return $this->snapshots;
    }
}
