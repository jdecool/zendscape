# 0004. Lay out the 3D scene by physical address

Date: 2026-10-02

## Status

Accepted

## Context

Heapscape shows both the physical layout (GC regions) and the logical graph (references, roots).
The PHP equivalents are:

- Physical: ZendMM chunks of 2 MiB, each made of 512 pages of 4 KiB, small allocations grouped in bins, and huge allocations outside chunks.
- Logical: the graph of objects, arrays, and strings, with roots (globals, class statics, call frames, the cyclic GC root buffer) and retention paths.

A 3D scene needs a spatial layout.
The options were:

- By physical address.
- Force-directed, which reli already offers as "3D Force".
  It is unstable between snapshots and unreadable beyond a few tens of thousands of nodes.
- Logical hierarchy: roots at the center, then classes, then instances.

`.rmem` nodes carry their address, so the chunk (`address & ~(2 MiB - 1)`) and the page (`(address >> 12) & 511`) can be derived.

## Decision

The scene is laid out by physical address.
Each chunk is a block, its pages form a grid, and each value sits in its page.
Huge allocations are drawn as separate blocks.

The logical graph is shown through reference bundles in the scene and through 2D side panels (retention paths, roots, rankings).

Everything is analyzed, nothing is sampled.
Only rendering is budgeted:

- Level of detail by distance: from far away a chunk is a block colored by occupancy, at medium distance pages appear, up close individual values.
- Reference bundles are drawn only for the current selection, with adjustable depth, never for the whole graph.

## Consequences

- The layout is deterministic and needs no physics simulation, so it scales.
- The same value at the same address sits at the same place in two snapshots, which makes diff highlighting readable ([0006](0006-snapshot-diff-identity.md)).
- It differentiates Zendscape from reli's existing visualizations.
- Fragmentation and chunk occupancy become visible, which has teaching value.
- Values that are logically related may be far apart in space.
  Bundles and side panels compensate.
