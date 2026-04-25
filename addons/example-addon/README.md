# Example Addon

Hello-world extension demonstrating the sandboxed Trixty extension runtime.

## Runtime model

- The extension runs inside a dedicated Web Worker. It cannot reach the
  DOM, React, Tauri IPC, or any other extension.
- The host only exposes the capabilities listed under `trixty.capabilities`
  in `package.json`. The user approves or denies each capability the first
  time the extension is loaded.
- UI is declarative: `render()` returns a `{ tag, props, children }` schema
  that the host turns into React elements. Event handlers are plain
  functions on the schema; the sandbox assigns them handler IDs and
  round-trips events back to the worker.

## Capability list

| Capability | Why this extension needs it |
| --- | --- |
| `ui:register-view` | Adds the left-sidebar snippet panel and right-panel clock. |
| `ui:show-message` | Flashes "saved" / "copied" toasts. |
| `l10n:register` | Ships English, Spanish, and French strings. |
| `lang:register` | Registers the `trixty-dsl` demo language with Monaco. |
| `storage:read` / `storage:write` | Persists snippets across launches. |
| `clipboard:write` | Copies snippet text to the system clipboard. |
