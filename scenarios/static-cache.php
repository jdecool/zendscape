<?php

declare(strict_types=1);

// An unbounded static cache: every processed message adds an entry, nothing evicts.

require __DIR__ . '/harness.php';

final class Product
{
    public function __construct(
        public readonly int $id,
        public readonly string $name,
    ) {}
}

final class ProductCache
{
    /** @var array<string, Product> */
    public static array $items = [];
}

function handleMessages(int $from, int $to): void
{
    for ($id = $from; $id < $to; $id++) {
        ProductCache::$items["product-{$id}"] = new Product($id, "Product #{$id}");
    }
}

scenario(
    static fn() => handleMessages(0, 100),
    static fn() => handleMessages(100, 1_100),
);
