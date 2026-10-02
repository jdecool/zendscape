<?php

declare(strict_types=1);

// Parent/child cycles become unreachable but survive because the cycle
// collector is disabled, as long-running workers sometimes do for speed.

require __DIR__ . '/harness.php';

final class TreeNode
{
    public ?TreeNode $parent = null;

    /** @var list<TreeNode> */
    public array $children = [];
}

function buildAndDropTrees(int $count): void
{
    for ($i = 0; $i < $count; $i++) {
        $root = new TreeNode();
        $child = new TreeNode();
        $child->parent = $root;
        $root->children[] = $child;
    }
}

gc_disable();

scenario(
    static fn() => buildAndDropTrees(50),
    static fn() => buildAndDropTrees(500),
);
