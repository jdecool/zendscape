<?php

declare(strict_types=1);

// Each request subscribes a listener to a shared dispatcher and never
// unsubscribes it, so listeners accumulate for the lifetime of the worker.

require __DIR__ . '/harness.php';

final class EventDispatcher
{
    /** @var array<string, list<callable>> */
    private array $listeners = [];

    public function addListener(string $event, callable $listener): void
    {
        $this->listeners[$event][] = $listener;
    }

    public function dispatch(string $event): void
    {
        foreach ($this->listeners[$event] ?? [] as $listener) {
            $listener();
        }
    }
}

final class AuditListener
{
    public function __construct(
        public readonly string $requestId,
    ) {}

    public function onUserUpdated(): void {}
}

$dispatcher = new EventDispatcher();

$handleRequests = static function (int $from, int $to) use ($dispatcher): void {
    for ($i = $from; $i < $to; $i++) {
        $dispatcher->addListener('user.updated', [new AuditListener("req-{$i}"), 'onUserUpdated']);
    }
};

scenario(
    static fn() => $handleRequests(0, 50),
    static fn() => $handleRequests(50, 550),
);
