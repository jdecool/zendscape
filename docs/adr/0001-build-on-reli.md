# 0001. Build on reli-prof for memory extraction

Date: 2026-10-02

## Status

Accepted

## Context

Heapscape relies on ClrMD to read the .NET managed heap.
PHP has no official equivalent.
The options were:

- In-process instrumentation such as `php-meminfo`, which requires a C extension that must track every PHP release and has struggled with PHP 8.x.
- Writing our own extension.
- Reading Zend structures from a core dump or a live process ourselves.
- Reusing [reli-prof](https://github.com/reliforp/reli-prof), which already reads a live process (ptrace, `process_vm_readv`), a core dump, or an in-process dump (`ext-rdump`) and produces a `.rmem` memory graph with roots, retained sizes, cycles, and addresses.

reli also ships a TUI, HTML visualizations (including a 3D force graph), a query server, an MCP server, and snapshot comparison.
What it lacks is a spatial, Heapscape-like exploration that ties the physical ZendMM layout to the logical reference graph.

reli exposes three integration surfaces:

- `rmem:serve`, a JSON-over-Unix-socket query server, which answers one query at a time and offers no bulk access.
- A JSON export (`StreamingJsonFromRmemExporter`), which becomes very large and leaves us reimplementing retention and cycle queries.
- Its PHP classes, notably `Rmem\Explore\RmemModel` and `Rmem\Serve\RmemQueryService`.

The `.rmem` binary format is undocumented and not stable before reli 1.0.

## Decision

Zendscape is a separate project and a client of reli.
It never extracts memory itself and only reads `.rmem` files.

reli is a Composer dependency pinned to an exact version.
The backend uses `RmemModel` and `RmemQueryService` in-process.
All code touching reli lives in a single adapter module, and nothing else in the codebase imports reli classes.

We do not parse the `.rmem` binary format ourselves.
The one exception is data reli records but does not expose through its classes, such as object handles carried by non-tree edge names.
The adapter then reads the section through reli's own `Reader` and `Format`, never with a parser of our own.

The adapter instantiates the reli classes it needs directly.
It never boots reli's DI container or console application, which load Linux-only libraries through FFI and fail on macOS ([spike 0](../spike-0.md)).

The pinned version is `reliforp/reli-prof` `0.12.0`.

## Consequences

- We get every node for the scene and reli's rich queries (path to root, cycles, rankings) for free.
- We inherit reli's runtime requirements: PHP 8.4+, `ext-ffi`, `ext-pcntl`.
- reli's internal classes may change between versions.
  The pinned version, the adapter boundary, and contract tests on reference snapshots ([0008](0008-reference-scenarios-testing.md)) contain that risk to one module.
- PHP version support for target processes is whatever reli supports.
