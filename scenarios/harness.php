<?php

declare(strict_types=1);

/**
 * Drives a scenario through two observable phases so the capture tool can
 * snapshot it before (t0) and after (t1) the leak grows. Files in the signal
 * directory are the only synchronisation channel: the capture tool runs
 * outside the PHP process and cannot call into it.
 */
function scenario(Closure $setup, Closure $grow): never
{
    $signals = getenv('ZENDSCAPE_SIGNALS') ?: throw new InvalidArgumentException('ZENDSCAPE_SIGNALS must point to the signal directory');

    $setup();
    file_put_contents("{$signals}/pid", (string) getmypid());
    waitFor("{$signals}/grow");

    $grow();
    touch("{$signals}/grown");

    while (true) {
        sleep(1);
    }
}

function waitFor(string $file): void
{
    while (!file_exists($file)) {
        usleep(50_000);
    }
}
