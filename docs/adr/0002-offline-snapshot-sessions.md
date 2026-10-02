# 0002. Offline snapshots first, sessions as ordered snapshot lists

Date: 2026-10-02

## Status

Accepted

## Context

Heapscape opens a dump file.
A live mode, attaching to a running PHP process from the app, is tempting.

With reli, "live" cannot be a continuous stream.
Each capture stops the target with `SIGSTOP` while it is dumped.
Analysis from `.rdump` to `.rmem` takes from seconds to over a minute on large heaps, cycle detection alone costing 30 to 60 seconds.
Live therefore means a series of snapshots triggered from the app.

Live capture also requires Linux, `CAP_SYS_PTRACE`, and the same PID namespace as the target, which on macOS means running the app inside Docker next to the target.
It turns the app into something able to freeze and read any PHP process, which raises the security bar.

## Decision

v1 only opens `.rmem` files produced by reli.

The core data model is a session: an ordered list of snapshots.
A single-file exploration is a session of one snapshot.
Diff ([0006](0006-snapshot-diff-identity.md)) operates on two snapshots of a session.

Live capture comes in v2 as an additional snapshot source that drives reli (dump then analyze, possibly through reli's `sidecar` or `watch`), with progress reporting and cancellation.

## Consequences

- Capture (Linux, privileged) is decoupled from exploration (any OS with PHP 8.4 and FFI).
- Adding live capture later requires no redesign, only a new source feeding the same session model and a timeline in the UI.
- Users must run reli themselves in v1.
