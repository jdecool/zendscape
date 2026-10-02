# 0007. Security and privacy defaults

Date: 2026-10-02

## Status

Accepted

## Context

Memory snapshots contain secrets: environment variables, API tokens, session data, user data.
Screenshots of the scene are likely to be shared in chats and issues.
Heapscape addresses this with loopback-only binding, no external resources, temporary uploads, and an opt-in "Include strings" option.

## Decision

- The server binds to 127.0.0.1 only.
- No CDN, no telemetry, no outbound network calls.
  All frontend assets are bundled.
- Temporary files are deleted when a snapshot is closed and on graceful shutdown.
  This is not secure erasure, and the documentation says so.
- String values are masked by default and revealed only through an explicit option.
- The UI and documentation warn to open only trusted snapshots.

## Consequences

- Snapshots never leave the machine through Zendscape.
- A screenshot of the default view does not leak string contents.
- Remote use (exploring a snapshot on a server) requires an SSH tunnel, by design.
