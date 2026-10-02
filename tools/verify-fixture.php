<?php

declare(strict_types=1);

// Runs inside the reli container, where reli is installed under /app, or
// locally against the copy of reli the backend depends on.
require is_file('/app/vendor/autoload.php') ? '/app/vendor/autoload.php' : __DIR__ . '/../backend/vendor/autoload.php';

use Reli\Inspector\Output\MemoryOutput\BinaryFormat\Reader;
use Reli\Inspector\Output\MemoryOutput\Report\Substrate\GraphSubstrate;

$args = $_SERVER['argv'] ?? null;
$path = is_array($args) ? $args[1] ?? null : null;
if (!is_string($path)) {
    fwrite(STDERR, "usage: php verify-fixture.php <file.rmem>\n");
    exit(2);
}

$substrate = GraphSubstrate::createFromBinary(Reader::open($path), skipScc: true);

foreach ($substrate->getRoots() as $root) {
    if ($substrate->getTreeLinkName($root) === 'objects_store') {
        if ($substrate->getAllChildren($root) !== []) {
            exit(0);
        }
        fwrite(STDERR, "{$path}: objects_store is empty\n");
        exit(1);
    }
}

fwrite(STDERR, "{$path}: no objects_store root\n");
exit(1);
