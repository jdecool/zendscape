# 0008. Test with reference leak scenarios

Date: 2026-10-02

## Status

Accepted

## Context

Zendscape depends on reli internals ([0001](0001-build-on-reli.md)) and must stay correct across reli upgrades.
Synthetic data alone would not catch a change in what reli actually produces.

## Decision

The repository contains small PHP scripts reproducing typical leaks:

- A static array used as an unbounded cache.
- An object reference cycle.
- A closure capturing `$this` and stored globally.
- Event listeners registered and never removed.

They are run and captured with reli inside Docker to produce reference `.rmem` files, committed to the repository and regenerated when reli is upgraded.

On top of them:

- Contract tests on the reli adapter.
- Unit tests on the physical layout computation.
- A Playwright end-to-end test that opens a reference snapshot and checks the leak can be found through the UI.

## Consequences

- A reli upgrade that changes behavior fails the contract tests immediately.
- The scenarios double as demos and as documentation of what each kind of leak looks like.
- Committed `.rmem` files add binary weight to the repository.
  Scenarios are kept small to bound it.
- Regenerating fixtures needs Docker on Linux.
