<?php

declare(strict_types=1);

namespace Zendscape\Tests;

use PHPUnit\Framework\TestCase;

final class ArchitectureTest extends TestCase
{
    // ADR 0001: a reli upgrade must only be able to break the adapter.
    public function testOnlyTheSnapshotAdapterDependsOnReli(): void
    {
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(__DIR__ . '/../src'));
        $offenders = [];

        foreach ($files as $file) {
            if ($file instanceof \SplFileInfo && $file->getExtension() === 'php'
                && $file->getFilename() !== 'Snapshot.php'
                && preg_match('/\bReli\\\\/', (string) file_get_contents($file->getPathname())) === 1) {
                $offenders[] = $file->getPathname();
            }
        }

        self::assertSame([], $offenders);
    }
}
