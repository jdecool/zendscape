<?php

declare(strict_types=1);

// A closure registered globally captures $this, so every handler and its
// payload outlive the request that created them.

require __DIR__ . '/harness.php';

final class RetryRegistry
{
    /** @var list<Closure> */
    public static array $callbacks = [];
}

final class OrderHandler
{
    /** @var list<int> */
    private array $payload;

    public function __construct(int $size)
    {
        $this->payload = range(1, $size);
    }

    public function handle(): void
    {
        RetryRegistry::$callbacks[] = fn(): int => count($this->payload);
    }
}

function handleOrders(int $count): void
{
    for ($i = 0; $i < $count; $i++) {
        new OrderHandler(100)->handle();
    }
}

scenario(
    static fn() => handleOrders(20),
    static fn() => handleOrders(200),
);
