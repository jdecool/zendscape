# 0005. Columnar binary transport for nodes

Date: 2026-10-02

## Status

Accepted

## Context

The scene needs every node of a snapshot.
With a million nodes, JSON costs hundreds of megabytes and seconds of parsing in the browser.
The GPU consumes flat typed arrays anyway.

## Decision

Bulk node data is sent as columnar binary: one `ArrayBuffer` per field (address, shallow size, class id, node type, refcount), loaded as `TypedArray` and fed directly to `InstancedMesh` attributes.
Strings such as class names are sent once as a JSON dictionary indexed by class id.

Edges are aggregated per pair of pages for bundle rendering.
Detailed edges come from point queries on selection.

Point queries (node detail, retention paths, rankings, search, diff results) use JSON.

## Consequences

- Near zero-copy loading on the frontend.
- The binary layout is a contract between backend and frontend, versioned with the app.
  Both live in the same repository, so they evolve together.
- Debugging bulk payloads needs a small inspection helper rather than reading JSON.
