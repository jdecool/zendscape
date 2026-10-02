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
- Requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` are rejected.
  Binding to loopback alone does not stop DNS rebinding, where a web page resolves its own domain to 127.0.0.1 and reads the API as same-origin.
- No CORS headers are ever sent.
  Uploads use `application/octet-stream` and closing a snapshot uses `DELETE`, both of which require a preflight that foreign origins cannot pass.
- No CDN, no telemetry, no outbound network calls.
  All frontend assets are bundled.
- Temporary files are deleted when a snapshot is closed and on graceful shutdown.
  This is not secure erasure, and the documentation says so.
- String values are masked by default and revealed only through an explicit option (`?reveal=strings`).
  Masking covers node labels too, since reli embeds string values in them.
- The UI and documentation warn to open only trusted snapshots.

## Consequences

- Snapshots never leave the machine through Zendscape.
- A screenshot of the default view does not leak string contents.
- Remote use (exploring a snapshot on a server) requires an SSH tunnel, by design.
