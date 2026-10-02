# Spike 0 - Findings

Date: 2026-10-02

Phase 0 of the [plan](plan.md): verify the assumptions behind the ADRs before writing production code.

## Setup

- reli-prof 0.12.0, the latest release (the `0.13.x` branch is unreleased).
- Capture and analysis in the official `reliforp/reli-prof` Docker image, native arm64, PHP 8.5, run with `--cap-add SYS_PTRACE --security-opt seccomp=unconfined`.
- Exploration on macOS (arm64), Homebrew PHP 8.5 with FFI, reli installed with `composer create-project reliforp/reli-prof reli 0.12.0`.
- Two targets: a small script (2 `Foo` in a cycle, 100 `Bar` in a static array), and a large one (300,000 objects each holding an array, then 50,000 more objects in a static array, one freed handle reused by an object of another class).

## Results

### Object handles are in `.rmem`, but not through `RmemModel`

The `objects_store` root has one edge per live object, and the edge link name is the object handle (`"1"`, `"2"`, ...).
These are non-tree edges.
`RmemModel::getChildren()` and every substrate API only return the tree link name of a child (for example `value` or `peer`), never the name of a non-tree edge.

The handle is read by scanning the `edges` section through reli's public `Reader`:

```php
$reader = Reader::open($path);
$data = $reader->getSectionData(Format::SECTION_EDGES);
$dict = $reader->getStringDict();
// row: parent u32, child u32, link_name_id u32, is_tree u8, strength u8, pad u16
for ($i = 0, $o = 0, $n = $reader->getSectionElementCount(Format::SECTION_EDGES); $i < $n; $i++, $o += Format::EDGE_ROW_SIZE) {
    ['p' => $parent, 'c' => $child, 'l' => $link] = unpack('Vp/Vc/Vl', $data, $o);
    if ($parent === $objectsStoreNodeId) {
        $handles[$child] = (int) $dict->lookup($link);
    }
}
```

This couples the adapter to the edge row layout of `.rmem` format version 1.

### Handle-based diff works

On the large target, T0 (300,000 handles) compared with T1 (350,000 handles):

- 50,000 new handles, all `Item`, exactly the objects added between the snapshots.
- 0 handles gone.
- Handle 6 detected as reused: `Item` at T0, `Leak` at T1.
  The class guard of [ADR 0006](adr/0006-snapshot-diff-identity.md) works.

### Intermittent reli bug: empty `objects_store`

One capture of the large target out of four produced an `.rdump` whose analysis has an empty `objects_store` (0 edges) while 300,000 objects exist in the graph.
Re-analyzing that `.rdump` reproduces it every time, so the defect happens at dump time, not at analysis.
Neither the object count nor the bucket table crossing 2 MiB explains it: captures of 1,000 to 300,000 objects were all correct.
The faulty dump is kept locally for a future upstream report.

Consequence: handles may be missing from a snapshot, and Zendscape must detect it.

### `.rmem` loads natively on macOS, without reli's container

- Loading `Reader`, `GraphSubstrate::createFromBinary()`, and `RmemModel::fromSubstrate()` directly works on macOS.
- reli's console commands do not: its DI container eagerly builds a `MemoryReader` loading `libc.so.6` through FFI, which fails on macOS.
  The adapter must instantiate the classes it needs itself and never boot reli's container or console.

### Performance

| | Small target | Large target |
|---|---|---|
| Nodes / edges | 20,042 / 24,999 | 2,719,531 / 3,324,251 |
| `.rdump` size | 5.8 MB | 142 to 153 MB |
| `.rmem` size | 2.2 MB | 275 to 295 MB |
| Analysis `.rdump` to `.rmem` (Docker) | under 1 s | 25 to 27 s |
| Load on macOS, without SCC | 0.17 s, 12 MB | 15.9 s, 1.06 GB |
| Load on macOS, with SCC | - | 21.4 s, 1.07 GB |

300,000 objects become 2.7 million nodes: every array, property table, and string is a node.
The scene must not instantiate one mesh per node at the lowest zoom level, as already planned in [ADR 0004](adr/0004-physical-address-scene-layout.md).
The backend needs about 400 bytes of PHP memory per node, so its `memory_limit` must be configurable.
Loading takes seconds on large heaps and needs a progress indicator.

### Node data available

`RmemModel::nodeDetail()` returns type, class, shallow and retained size, address, refcount, string value, attributes, and source location (`file:line` of the class definition).
`pathToRoot()`, `getParents()`, `getNodesByClass()`, rankings, and search work as documented.

## Decisions

- Pin `reliforp/reli-prof` to `0.12.0`.
- [ADR 0006](adr/0006-snapshot-diff-identity.md) is accepted, with the handle read from the `edges` section and a fallback when handles are missing.
- [ADR 0001](adr/0001-build-on-reli.md) is amended: the adapter may read `.rmem` sections through reli's `Reader` and `Format`, and must not boot reli's container.
- macOS is supported for exploration.
