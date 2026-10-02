# 0005. Columnar binary transport for nodes

Date: 2026-10-02

## Status

Accepted

## Context

The scene needs every node of a snapshot.
With a million nodes, JSON costs hundreds of megabytes and seconds of parsing in the browser.
The GPU consumes flat typed arrays anyway.

## Decision

Bulk scene data is sent as columnar binary, one column per field, loaded as `TypedArray` and fed directly to `InstancedMesh` attributes.
Since the scene places allocations rather than nodes ([0004](0004-physical-address-scene-layout.md)), each row is an allocation: its block, offset in the block, size, owning node, class, node type, and region.
Strings such as class names are sent once in a JSON header, as dictionaries indexed by the columns.
Addresses are 64-bit and exceed what JavaScript numbers hold exactly, so only block base addresses travel, as hex strings, and allocations are block-relative.
The byte layout is documented in `backend/src/Http/AllocationsPayload.php`, next to the code that writes it.

Reference bundles are only drawn for the current selection ([0004](0004-physical-address-scene-layout.md)), so no bulk edge data is sent.
Edges come from point queries on selection (references with depth, retention paths).

Point queries (node detail, retention paths, rankings, search, diff results) use JSON.

## Consequences

- Near zero-copy loading on the frontend.
- The binary layout is a contract between backend and frontend, versioned with the app.
  Both live in the same repository, so they evolve together.
- Debugging bulk payloads needs a small inspection helper rather than reading JSON.
