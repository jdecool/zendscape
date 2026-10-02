# 0003. PHP backend, TypeScript and Three.js frontend

Date: 2026-10-02

## Status

Accepted

## Context

The app needs a local server that loads snapshots and serves a browser UI.
Candidates for the backend were PHP, Node/TypeScript, and Go/Rust.
Candidates for the frontend were TypeScript with Three.js, the same plus a UI framework, or vanilla JavaScript without a build step.

## Decision

### Backend

PHP 8.4+, with reli as a library ([0001](0001-build-on-reli.md)).
The HTTP server is built on amphp, already a reli dependency.
It binds to 127.0.0.1 only.

### Frontend

TypeScript, Vite, and Three.js.
Values are rendered with `InstancedMesh` to handle hundreds of thousands of instances.
Side panels (search, inspection, rankings, diff) use plain DOM or native Web Components, without a UI framework.

### Repository and distribution

A monorepo with `backend/` and `frontend/`.
Distributed as a Composer package embedding the prebuilt frontend, and as a Docker image.
No PHAR: FFI requirements and the embedded frontend complicate packaging for little gain.

The UI is in English.

## Consequences

- The tool lives in the PHP ecosystem it serves, and PHP developers can contribute to the backend.
- Direct in-process access to reli data, no external process to orchestrate.
- Users installing through Composer need PHP 8.4 with FFI.
  The Docker image covers machines without it and prepares the v2 live capture (Linux, ptrace).
- The Three.js scene carries all the complexity.
  A UI framework would add a dependency for a handful of panels.
