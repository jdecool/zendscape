<?php

declare(strict_types=1);

return new PhpCsFixer\Config()
    ->setRiskyAllowed(true)
    ->setRules([
        '@PER-CS' => true,
        '@PHP8x4Migration' => true,
        'declare_strict_types' => true,
    ])
    ->setFinder(
        PhpCsFixer\Finder::create()
            ->in([__DIR__ . '/src', __DIR__ . '/tests', __DIR__ . '/../scenarios', __DIR__ . '/../tools'])
            ->append([__FILE__]),
    );
