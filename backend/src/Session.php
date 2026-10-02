<?php

declare(strict_types=1);

namespace Zendscape;

use Zendscape\Snapshot\Snapshot;

/**
 * Snapshots explored together (ADR 0002), keyed by a stable id. Ids grow
 * with insertion, so they also give capture order, which diffing relies on.
 */
final class Session
{
    /** @var array<int, array{name: string, snapshot: Snapshot}> */
    private array $entries = [];

    private int $nextId = 1;

    public function add(string $name, Snapshot $snapshot): int
    {
        $id = $this->nextId++;
        $this->entries[$id] = ['name' => $name, 'snapshot' => $snapshot];

        return $id;
    }

    public function remove(int $id): void
    {
        unset($this->entries[$id]);
    }

    public function has(int $id): bool
    {
        return isset($this->entries[$id]);
    }

    public function snapshot(int $id): Snapshot
    {
        return ($this->entries[$id] ?? throw new \OutOfRangeException("No snapshot #{$id} in session"))['snapshot'];
    }

    /** @return array<int, array{name: string, snapshot: Snapshot}> */
    public function entries(): array
    {
        return $this->entries;
    }
}
