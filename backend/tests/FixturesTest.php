<?php

declare(strict_types=1);

namespace Zendscape\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class FixturesTest extends TestCase
{
    private const string ROOT = __DIR__ . '/../..';

    /** @return iterable<string, array{string}> */
    public static function scenarios(): iterable
    {
        foreach (glob(self::ROOT . '/scenarios/*.php') ?: [] as $file) {
            $name = basename($file, '.php');
            if ($name !== 'harness') {
                yield $name => [$name];
            }
        }
    }

    // Catches a scenario added or renamed without regenerating fixtures.
    #[DataProvider('scenarios')]
    public function testEachScenarioHasBothSnapshots(string $scenario): void
    {
        foreach (['t0', 't1'] as $phase) {
            $path = self::ROOT . "/fixtures/{$scenario}.{$phase}.rmem";
            self::assertFileExists($path);
            self::assertSame('RMEM', file_get_contents($path, length: 4));
        }
    }
}
