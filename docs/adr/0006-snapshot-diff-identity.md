# 0006. Identify values across snapshots for diff

Date: 2026-10-02

## Status

Accepted, verified in [spike 0](../spike-0.md)

## Context

The core question for a leaking worker is "what grew between T0 and T1?".
Diff is therefore a v1 feature, delivered right after single-snapshot exploration.

ZendMM reuses addresses, so the same address does not mean the same value.
reli's `inspector:memory:compare` works on aggregates by class.
We want to highlight individual new objects in the scene.

## Decision

- Objects are identified by the pair (handle in `EG(objects_store)`, class).
  The handle is stable while the object lives, and the class guards against slot reuse.
  In `.rmem`, the handle is the link name of the edge from the `objects_store` root to the object.
  It is not exposed by `RmemModel`, so the reli adapter reads it from the `edges` section.
- When a snapshot has objects but no `objects_store` edges (an intermittent reli capture defect), its handles are reported as unavailable.
  Diff then falls back to class-level aggregates plus path-based comparison, and the UI says so.
- Arrays and strings have no identity.
  They are compared in aggregate, keyed by their path from a root and their owning class or property.
  This reports findings such as "`App\Cache::$items` grew by 40 MB".

The scene highlights new objects individually and grown structures by their location.

## Consequences

- Leaks light up individually in a stable layout ([0004](0004-physical-address-scene-layout.md)).
- A handle freed and reused by a new object of the same class is seen as the same object.
  This is rare enough to accept and only affects individual highlighting, not aggregate growth.
- The adapter depends on the edge row layout of `.rmem` format version 1, and checks the format version when opening a file.
