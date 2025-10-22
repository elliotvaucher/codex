# Codex Electron Proof of Concept

This package hosts a lightweight Electron shell that reuses the existing
`codex app-server` daemon. It demonstrates two layers:

1. **Bridge** – `AppServerBridge` lives in the main process, spawns the Rust
   app server, and exposes a small typed API for JSON-RPC requests and
   responses.
2. **Renderer** – a minimal UI that streams Codex events, shows the raw JSON
   feed, and can enqueue simple user messages.

## Running the demo

```bash
cd apps/electron-poc
pnpm install
pnpm dev   # compiles TypeScript and launches Electron
```

The app assumes a `codex` executable is available on your `PATH`. If you need
to point at a different binary, set `CODEX_BIN` before launching and the bridge
will use it instead.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/appServerBridge.ts` | TypeScript wrapper that spawns `codex app-server`, logs JSON-RPC traffic, and surfaces typed helper methods. |
| `src/main.ts` | Electron main process, wiring the bridge and IPC plumbing. |
| `src/preload.ts` | Exposes a narrow, typed surface to the renderer via `contextBridge`. |
| `src/renderer/index.html` / `renderer.js` | Lightweight UI that visualises events and queues sample user messages. |

This is only a starting point—the renderer currently focuses on logging rather
than a production chat experience—but it is ready to extend into richer UI
concerns or to swap in a React/Vue front-end as needed.
