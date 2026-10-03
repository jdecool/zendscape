# Zendscape

An interactive 3D explorer for PHP memory snapshots.

Zendscape is inspired by [Heapscape](https://github.com/kkokosa/heapspace), a 3D explorer for .NET memory dumps.
It brings the same experience to PHP: fly over the Zend Memory Manager heap byte by byte, inspect objects, follow why they are still alive, and watch leaks light up between two snapshots.

## Why

Long-running PHP processes (Symfony Messenger workers, RoadRunner, FrankenPHP, Swoole, ReactPHP) leak memory in ways that are hard to see.
[reli-prof](https://github.com/reliforp/reli-prof) already extracts a complete memory graph from a live PHP process or a core dump without modifying the target.
Zendscape is the exploration layer on top of it: a spatial, visual way to answer "why is this object still alive?" and "what grew between two snapshots?".

```
 PHP process ──reli──▶ .rdump ──reli──▶ .rmem ──▶ Zendscape ──▶ browser
 (Linux, ptrace)                                  (127.0.0.1)
```

Capture requires Linux.
Exploration runs anywhere PHP 8.4 with FFI runs, or in Docker.

## Install

With Docker:

```bash
git clone <this repository> zendscape && cd zendscape
docker build -t zendscape .
```

With PHP 8.4.1+, `ext-ffi` and `ext-pcntl`:

```bash
git clone <this repository> zendscape && cd zendscape
composer install --no-dev
```

Once the package is published, `composer global require zendscape/zendscape` installs the `zendscape` command, with the built frontend inside the package.

## Try it with the bundled examples

The repository ships four leaks captured with reli, so you can explore without capturing anything.
Each leak is a script in `scenarios/` and two snapshots in `fixtures/`: before (`t0`) and after (`t1`) the leak grows.

| Scenario | Leak | Class to look for |
|----------|------|-------------------|
| `static-cache` | A static array used as a cache that nothing evicts | `Product` |
| `listeners` | Event listeners added on every request and never removed | `AuditListener` |
| `closure-this` | Closures stored globally that keep `$this` alive | `OrderHandler` |
| `object-cycle` | Parent and child objects in cycles, with the cycle collector disabled | `TreeNode` |

Open the `static-cache` pair:

```bash
backend/bin/zendscape serve fixtures/static-cache.t0.rmem fixtures/static-cache.t1.rmem
# or with Docker:
docker run --rm -p 127.0.0.1:7777:7777 -v "$PWD/fixtures:/snapshots:ro" zendscape serve /snapshots/static-cache.t0.rmem /snapshots/static-cache.t1.rmem
```

Then open http://127.0.0.1:7777/ and:

1. Click a page in the scene to fly to it, then click an allocation to inspect it.
2. In the inspector, open Classes, pick `Product`, then an instance.
   "Why is it still alive?" shows `class_table › productcache › static_properties › items`, drawn as orange arcs in the scene.
3. In "Compare with", pick `static-cache.t0.rmem`.
   The Changes tab shows the `items` array growing by about 215 KB and 1,000 new `Product` objects, which turn green in the scene.

Replace `static-cache` with another scenario name to explore the other leaks.
In `object-cycle`, "Why is it still alive?" explains that no root reaches the objects: they are garbage the cycle collector has not freed.

## Walkthrough: find a leaking worker

### 1. Capture two snapshots with reli

Take one snapshot, let the worker run for a while, then take another.
reli attaches to the process from the outside: the worker needs no change.
For a worker running in a container named `worker`:

```bash
reli() {
  docker run --rm --pid=container:worker --cap-add=SYS_PTRACE --security-opt seccomp=unconfined \
    -v "$PWD:/work" reliforp/reli-prof:0.12.0 "$@"
}

reli inspector:memory:dump --pid=<worker pid> --output=/work/before.rdump
# ...let the worker process more messages...
reli inspector:memory:dump --pid=<worker pid> --output=/work/after.rdump

reli inspector:memory:analyze /work/before.rdump -f rmem -o /work/before.rmem
reli inspector:memory:analyze /work/after.rdump -f rmem -o /work/after.rmem
```

The worker is paused while each dump is taken.
See [reli's documentation](https://github.com/reliforp/reli-prof/tree/0.12.0/docs) for core dumps, `ext-rdump`, and other setups.

### 2. Open them in Zendscape

```bash
docker run --rm -p 127.0.0.1:7777:7777 -v "$PWD:/snapshots:ro" zendscape serve /snapshots/before.rmem /snapshots/after.rmem
# or, from a clone with PHP:
backend/bin/zendscape serve before.rmem after.rmem
```

Open http://127.0.0.1:7777/.
Snapshots can also be uploaded from the browser with "Open snapshot".

### 3. Explore the heap

The scene lays out the PHP heap by address: each ZendMM chunk is a slab of 512 pages, and each page is drawn as 64 rows of 64 bytes, so every allocation covers exactly the bytes it owns.
From afar, pages are bars as tall as they are full; up close, allocations appear one by one.
Color them by node type or by class from the legend.

Click a page to fly to it, click an allocation to inspect it.
Drag to orbit, right-drag to pan, scroll to zoom; press F to fly with W A S D, Esc to stop.

### 4. Ask why something is still alive

In the inspector, Classes lists objects by class.
Pick a class, then an instance: "Why is it still alive?" shows every chain of strong references from a root, such as `class_table › productcache › static_properties › items`, and the scene draws it as arcs between allocations.
An object no root reaches is garbage the cycle collector has not freed yet.

### 5. See what grew

Pick the earlier snapshot in "Compare with".
The Changes tab lists the structures that grew, most specific first, the new objects by class, and the classes that changed; the scene shows new objects in green.
Click a growing structure to fly to it.

## Privacy

Memory snapshots contain secrets: environment variables, tokens, user data.
Zendscape only listens on loopback, rejects requests for any other host name, uses no CDN and no telemetry, deletes uploaded snapshots when they are closed or when it stops, and masks string values until you tick "Show strings".
Only open snapshots you trust.

## Architecture

| Part | Choice |
|------|--------|
| Extraction | reli-prof 0.12.0, used as a Composer library behind a single adapter class |
| Backend | PHP 8.4+ (`ext-ffi`, `ext-pcntl`), amphp HTTP server bound to 127.0.0.1 |
| Frontend | TypeScript, Vite, Three.js (`InstancedMesh`), plain DOM panels |
| Bulk transport | Columnar binary (`TypedArray`) for allocations, JSON for point queries |
| Repository | Monorepo: `backend/`, `frontend/`, Composer at the root |
| Distribution | Composer package with the built frontend, Docker image |
| License | MIT |

Decisions and their rationale are recorded in [docs/adr](docs/adr).
The implementation plan is in [docs/plan.md](docs/plan.md), and the assumptions checked against real captures before building are in [docs/spike-0.md](docs/spike-0.md).

## Development

Requirements: PHP 8.4.1+ with `ext-ffi` and `ext-pcntl`, Composer, Node.js 24+, and Docker for regenerating fixtures.

```bash
composer install
composer lint         # PHP-CS-Fixer and PHPStan
composer test         # PHPUnit

cd frontend && npm install
npm run lint          # TypeScript and ESLint
npm test              # Vitest
npm run build         # outputs to backend/public, which is committed
npm run e2e           # Playwright, against the real server and the built frontend
npm run dev           # Vite dev server, proxies /api to a backend on port 7777

tools/capture-fixtures.sh   # capture every scenario in scenarios/ into fixtures/
```

Each scenario in `scenarios/` reproduces a typical leak: an unbounded static cache, garbage cycles with the collector off, closures capturing `$this`, listeners never removed.
The capture tool snapshots each one before (`t0`) and after (`t1`) its leak grows, and tests check the leak is found from those fixtures.
