# Architecture

This document is a stub. Until it is written, use these sources:

- The component diagram and package list at the top of `README.md`.
- The "Architecture" section of `CLAUDE.md`, including its integration status note.
- `kitty-specs/<feature>/spec.md` and `plan.md` for the design of each feature.

The desktop app has three layers. The React UI (`apps/desktop-companion/src/ui`) calls Tauri commands. The Rust shell (`apps/desktop-companion/src-tauri/src`) registers those commands and forwards most of them to the Node sidecar over line-delimited JSON-RPC on stdio. The sidecar (`apps/desktop-companion/src/sidecar`) registers the JSON-RPC methods and calls into the shared packages.
