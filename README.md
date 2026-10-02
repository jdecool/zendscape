# Zendscape

An interactive 3D explorer for PHP memory snapshots.

Zendscape is inspired by [Heapscape](https://github.com/kkokosa/heapspace), a 3D explorer for .NET memory dumps.
It brings the same experience to PHP: fly through the Zend Memory Manager heap, inspect objects, follow retention paths, and watch leaks light up between two snapshots.

> Status: design phase.
> Nothing is implemented yet.

## Why

Long-running PHP processes (Symfony Messenger workers, RoadRunner, FrankenPHP, Swoole, ReactPHP) leak memory in ways that are hard to see.
[reli-prof](https://github.com/reliforp/reli-prof) already extracts a complete memory graph from a live PHP process or a core dump without modifying the target.
Zendscape is the exploration layer on top of it: a spatial, visual way to answer "why is this object still alive?" and "what grew between T0 and T1?".

## How it works

```
 PHP process ──reli──▶ .rdump ──reli──▶ .rmem ──▶ Zendscape backend ──▶ browser (Three.js)
 (Linux, ptrace)                                  (PHP 8.4, 127.0.0.1)
```

1. Capture a snapshot with reli (`inspector:memory:dump`, `inspector:coredump`, or `ext-rdump` from inside the process).
2. Analyze it into a `.rmem` file with `inspector:memory:analyze`.
3. Open one or more `.rmem` files in Zendscape.

Capture requires Linux.
Exploration runs anywhere PHP 8.4 with FFI runs.

## Scope

### v1

- A session holds an ordered list of snapshots.
- 3D scene laid out by physical address: ZendMM chunks (2 MiB), pages (4 KiB), then individual values.
- Colors by node type or class.
- Search by class or address.
- Node inspection with incoming and outgoing references at adjustable depth.
- Path to root and all retention paths, drawn as reference bundles in the scene.
- Class ranking and top retained nodes.
- Diff between two snapshots, highlighting new objects and grown structures.

### Later

- Live capture triggered from the app (Linux, ptrace, Docker on macOS).
- Memory outside ZendMM (glibc heap used by C extensions).
- Opcache shared memory.
- MCP / AI assistant integration.

## Architecture

| Part | Choice |
|------|--------|
| Extraction | reli-prof, used as a pinned Composer library behind a single adapter module |
| Backend | PHP 8.4+ (`ext-ffi`, `ext-pcntl`), amphp HTTP server bound to 127.0.0.1 |
| Frontend | TypeScript, Vite, Three.js (`InstancedMesh`), plain DOM or Web Components for panels |
| Bulk transport | Columnar binary (`TypedArray`) for nodes, JSON for point queries |
| Repository | Monorepo with `backend/` and `frontend/` |
| Distribution | Composer package with the prebuilt frontend, plus a Docker image |
| License | MIT |

Decisions and their rationale are recorded in [docs/adr](docs/adr).
The implementation plan is in [docs/plan.md](docs/plan.md).

## Privacy

Memory snapshots contain secrets: environment variables, tokens, user data.
Zendscape only listens on loopback, uses no CDN and no telemetry, deletes temporary files on shutdown, and masks string values by default.
Only open snapshots you trust.

## Usage

```bash
backend/bin/zendscape serve [--port=7777] [--memory-limit=-1] [snapshot.rmem ...]
```

Open the printed URL.
Snapshots can be given on the command line or uploaded from the browser.

## Development

Requirements: PHP 8.4.1+ with `ext-ffi` and `ext-pcntl`, Composer, Node.js 24+, and Docker for regenerating fixtures.

```bash
# Backend
cd backend && composer install
composer lint   # PHP-CS-Fixer and PHPStan
composer test   # PHPUnit

# Frontend
cd frontend && npm install
npm run lint    # TypeScript and ESLint
npm test        # Vitest
npm run build   # outputs to backend/public
npm run dev     # Vite dev server, proxies /api to a backend on port 7777

# Fixtures: capture every scenario in scenarios/ into fixtures/
tools/capture-fixtures.sh
```

Each scenario in `scenarios/` reproduces a typical leak.
The capture tool snapshots it before (`t0`) and after (`t1`) the leak grows.

## Validation

Assumptions were verified against real captures before implementation, see [docs/spike-0.md](docs/spike-0.md).
