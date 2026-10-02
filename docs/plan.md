# Implementation plan

Phased plan for Zendscape v1, derived from the [ADRs](adr).
Each phase ends with exit criteria that must hold before starting the next one.

## Phase 0 - Spike: verify assumptions

Status: done, see [spike-0.md](spike-0.md).

Goal: remove the open questions before writing production code.

- Build a Linux Docker image with PHP 8.4 (FFI, pcntl) and reli-prof at the latest 0.13.x release.
- Write one throwaway PHP script holding a few objects of known classes, an array, and a reference cycle.
- Capture it with `inspector:memory:dump`, analyze it with `inspector:memory:analyze -f rmem`.
- Load the `.rmem` through `RmemModel` and dump what a node exposes: id, type, class, address, shallow and retained size, refcount, attributes, edges and their link names.
- Look for the `objects_store` handle, either as an attribute or as the link name of the `objects_store` branch children.
- Load the same `.rmem` with `RmemModel` on macOS, outside Docker.
- Measure load time and memory on a large heap (a few hundred thousand nodes).

Exit criteria:

- [ADR 0006](adr/0006-snapshot-diff-identity.md) confirmed or rewritten with the actual identity strategy.
- macOS support confirmed or documented as Docker-only.
- reli version chosen and pinned.
- Findings written down in `docs/spike-0.md`.

## Phase 1 - Repository skeleton and reference scenarios

Status: done.
CI has not run yet: the project is not a Git repository and has no remote.

- Monorepo layout: `backend/` (Composer, PHP 8.4), `frontend/` (Vite, TypeScript, Three.js).
- Tooling: PHPStan at max level, PHP-CS-Fixer, PHPUnit, ESLint, TypeScript strict, Vitest.
- CI running lint and tests for both sides.
- Leak scenarios from [ADR 0008](adr/0008-reference-scenarios-testing.md) in `scenarios/`: static cache, object cycle, closure capturing `$this`, listeners never removed.
- A script that runs each scenario in Docker, captures it with reli, and writes `fixtures/<scenario>.rmem`.
  Scenarios that support diff produce two snapshots (`t0`, `t1`).
- Committed fixtures.

Exit criteria: CI green, fixtures regenerable with a single command.

## Phase 2 - Backend core: adapter, session, layout

Status: done.
The adapter is `Zendscape\Snapshot\Snapshot`, enforced as the only reli dependent by `ArchitectureTest`.

- Reli adapter module, the only place importing reli classes ([ADR 0001](adr/0001-build-on-reli.md)).
  It exposes Zendscape's own types: snapshot, node, edge, root, and the query results needed later (path to root, retention paths, rankings, search).
- Session model: ordered list of snapshots ([ADR 0002](adr/0002-offline-snapshot-sessions.md)).
- Physical layout: derive chunk, page, and huge allocation for each node from its address ([ADR 0004](adr/0004-physical-address-scene-layout.md)).
- Contract tests of the adapter on every fixture.
- Unit tests of the layout computation.

Exit criteria: a PHP test can open each fixture and find its leak through the adapter alone.

## Phase 3 - HTTP API

Status: done.
Changes from the original plan:

- The bulk payload carries allocations, not nodes ([ADR 0004](adr/0004-physical-address-scene-layout.md), [ADR 0005](adr/0005-columnar-binary-transport.md)).
- No bulk edge endpoint: bundles are only drawn for the selection, from the references and retention paths endpoints.
- The server also rejects foreign `Host` headers against DNS rebinding ([ADR 0007](adr/0007-security-and-privacy-defaults.md)).
- Loading a large snapshot blocks the server for seconds; there is no progress reporting yet.

- amphp HTTP server bound to 127.0.0.1 ([ADR 0007](adr/0007-security-and-privacy-defaults.md)).
- CLI entry point: `zendscape serve [snapshot.rmem ...]` opens the given files in a session and prints the URL.
- Browser upload of `.rmem` files into temporary storage, deleted on close and on shutdown.
- Bulk endpoint returning columnar binary node data and the class dictionary ([ADR 0005](adr/0005-columnar-binary-transport.md)).
- Bulk endpoint returning edges aggregated per page pair.
- JSON endpoints: node detail, incoming and outgoing references with depth, path to root, retention paths, class ranking, top retained, search by class or address.
- String values masked unless explicitly requested.

Exit criteria: API tests against fixtures, binary payload layout documented next to the code that writes it.

## Phase 4 - 3D scene

- Three.js scene with chunks as blocks, pages as grids, values as `InstancedMesh` instances.
- Level of detail by camera distance: chunk occupancy, then pages, then values.
- Huge allocations as separate blocks.
- Coloring by node type or by class.
- Orbit, pan, and fly camera controls.
- GPU picking to select a value.

Exit criteria: the largest fixture renders smoothly (60 fps target on a laptop), selection works at every level of detail.

## Phase 5 - Inspection

- Side panels: search, node detail, references in and out with adjustable depth, class ranking, top retained.
- Retention paths and path to root drawn as luminous bundles in the scene, only for the current selection.
- Selecting in a panel flies the camera to the value, selecting in the scene updates the panels.
- Explicit toggle to reveal string values.

Exit criteria: for each single-snapshot fixture, the leak can be found from the UI.

## Phase 6 - Snapshot diff

- Load two snapshots of a session and pick T0 and T1.
- Match objects with the identity strategy settled in phase 0.
- Highlight new objects individually in the scene.
- Path-based growth report for arrays and strings ("`App\Cache::$items` grew by 40 MB"), each entry selectable in the scene.

Exit criteria: for each `t0`/`t1` fixture pair, the growing structure is highlighted and listed first.

## Phase 7 - Packaging and end-to-end

- Composer package embedding the prebuilt frontend.
- Docker image running `zendscape serve` with a mounted snapshot directory.
- Playwright end-to-end test: start the server on a fixture, open the UI, find the leak, run a diff.
- README usage section with a full walkthrough from capture to diagnosis.

Exit criteria: `composer global require` and `docker run` both work on a clean machine, end-to-end test green in CI.

## After v1

- Live capture from the app as a new snapshot source ([ADR 0002](adr/0002-offline-snapshot-sessions.md)).
- Memory outside ZendMM, opcache shared memory, MCP integration.
