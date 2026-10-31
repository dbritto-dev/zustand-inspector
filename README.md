# zustand-inspector

Framework-agnostic devtools for [Zustand](https://github.com/pmndrs/zustand), built on the **vanilla core of [TanStack Devtools](https://tanstack.com/devtools)**. No React required: it works with `zustand/vanilla` stores and renders with plain DOM.

- **Lossless time travel.** The page keeps the original state objects and the panel jumps by action id. Map, Set, Date, class instances and the store's own actions all survive a jump.
- **Action log** with names from `set(partial, replace, action)`, payloads from `{ type, ...payload }`, and caller-name inference when no name is given.
- **Structural diffs per action**, including per-entry Map and Set changes.
- **Redaction in the page**, before anything is sent. Keys ending in `token`, `password`, `secret`, `apiKey`, `cookie` and similar are redacted by default.
- **Pause and resume, commit, reset, export and import**, plus a scrubber and keyboard navigation (↑ ↓ Enter Esc).
- **Late-mount safe.** Open the panel whenever you like and it syncs the full history.
- **Production-safe.** It becomes a no-op when `process.env.NODE_ENV === 'production'`.

> Status: prototype (0.1.0). TanStack Devtools is still alpha (0.x), so the peer range is pinned to `0.16.x`.

## Usage

```ts
import { createStore } from 'zustand/vanilla'
import { inspector } from 'zustand-inspector'

type State = { count: number; inc: () => void; add: (n: number) => void }

export const counter = createStore<State>()(
  inspector(
    (set) => ({
      count: 0,
      inc: () => set((s) => ({ count: s.count + 1 })), // recorded as "inc" (inferred)
      add: (n) => set((s) => ({ count: s.count + n }), false, { type: 'add', n }),
    }),
    { name: 'counter' },
  ),
)
```

Mount the devtools in development only, so neither the shell nor the panel reaches production bundles:

```ts
if (import.meta.env.DEV) {
  const [{ TanStackDevtoolsCore }, { zustandInspectorPlugin }] = await Promise.all([
    import('@tanstack/devtools'),
    import('zustand-inspector/panel'),
  ])
  const host = document.body.appendChild(document.createElement('div'))
  new TanStackDevtoolsCore({ plugins: [zustandInspectorPlugin()] }).mount(host)
}
```

If you already use a framework adapter such as `@tanstack/react-devtools`, pass the same plugin object to its `plugins` array.

For a store you can't wrap (for example a third-party one), use `inspectStore`. It records every change as `setState` and still supports time travel:

```ts
import { inspectStore } from 'zustand-inspector'
const stop = inspectStore(someStore, { name: 'theme' })
```

To host the panel outside TanStack (a plain `<div>`, an extension page, a Vite DevTools dock), use `mountInspector(el, { transport })` from `zustand-inspector/panel`.

## Options

| Option | Default | |
|---|---|---|
| `name` | required | Store id shown in the panel. Re-registering the same name replaces the old store (HMR). |
| `maxHistory` | `100` | Ring-buffer size. Older actions are dropped, and the panel shows how many. |
| `redact` | `true` | `true`, `false`, a `RegExp` or `(key, path) => boolean`. |
| `sanitize` | none | `(state) => unknown` to hide or reshape state before it is serialized. |
| `maxDepth` / `maxItems` | `12` / `500` | Serialization limits. |
| `diff` | `true` | Compute per-action structural diffs. |
| `enabled` | not production | Force recording on or off. |
| `inferActionName` | `true` | Infer the action name from the calling function's name. |
| `anonymousActionType` | `'anonymous'` | Name used when nothing else is known. |
| `transport` | TanStack bus | Any object implementing `Transport`. |

## How it works

```
 page                                              panel (TanStack plugin / any host)
 ┌──────────────────────────────┐   transport     ┌──────────────────────────────┐
 │ inspector middleware          │  (versioned,    │ PanelView (vanilla DOM)       │
 │  └ StoreRecorder              │   JSON-safe,    │  timeline · state · diff      │
 │     ring buffer of ORIGINAL   │◀─ commands ─────│  scrubber · export/import     │
 │     states, ids, diffs        │── events ──────▶│                               │
 └──────────────────────────────┘   by id         └──────────────────────────────┘
```

- **The page owns the state.** The panel only receives serialized, redacted views. It never sends state back to time travel; it sends `{ type: 'jump', toId }`, and the page restores the exact object it recorded. `import` is the only command that carries state. It is rebuilt on top of the live state, so actions and redacted secrets keep their live values, and it is logged as `devtools/import`.
- **Versioned envelope.** Every message carries `{ v, session }`. The TanStack bus mirrors events to other tabs over BroadcastChannel, so the session id stops a panel in one tab from jumping stores in another.
- **Swappable transport.** The recorder and panel depend only on `Transport { send, on, reconnect? }`. Two are included: the TanStack EventClient (default) and an in-memory one. A `postMessage`, WebSocket or Rozenite transport can be added without touching either side.
- **TanStack quirks it handles:**
  - `render(el, props)` runs again on every theme or open change, so the plugin keeps one view per container.
  - The EventClient stops emitting for good if the bus isn't mounted within about 1.5 s, so the panel reopens the shared emitter when it mounts.
  - Reopening from inside an event handler would re-enter the client's queue flush, so it never does that.

Ideas borrowed (see the research report):
- zustand-devtools-bridge and Devframe: the page as the authority, with time travel by id.
- Stately: the versioned envelope.
- Preact Signals devtools: the split between UI and transport.
- NgRx: `withMapper` (here `sanitize`).
- Pinia: the pause flag while devtools writes to the store.
- Reactotron and Angular: redaction and session export.

## Limitations and next steps

- No skip or reorder of actions. These need recomputation from reducers, which a `set()`-based store doesn't have.
- Async actions show as separate rows. Next step: Pinia-style `groupId`s so `load:pending → load:fulfilled` collapse into one row.
- State editing from the panel, a "why did this subscriber run" view, and go-to-source for actions (from the stack trace) aren't built yet.
- Other hosts: a Redux DevTools adapter (so existing users keep their workflow), a WXT browser extension, Rozenite (React Native), and command endpoints that MCP-based coding agents can call.

## Development

```bash
npm install
npm run dev          # demo at http://localhost:5173 (?devtoolsDelay=3000 to test late mount)
npm test             # vitest: recorder + panel (jsdom)
npm run typecheck
npm run build        # dist/ (ESM) + dist/types
```
