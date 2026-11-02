# zustand-inspector

Devtools for [Zustand](https://github.com/pmndrs/zustand), as a plugin for [TanStack Devtools](https://tanstack.com/devtools). It follows TanStack's [plugin guides](https://tanstack.com/devtools/latest/docs/building-custom-plugins): an `EventClient` between the stores and the panel, a framework-agnostic core with a React adapter built the `@tanstack/devtools-utils` way, and no-op exports outside development.

- **Lossless time travel.** The page keeps the original state objects and the panel jumps by action id. Map, Set, Date, class instances and the store's own actions all survive a jump.
- **Action log** with names from `set(partial, replace, action)`, payloads from `{ type, ...payload }`, and caller-name inference when no name is given.
- **Structural diffs per action**, including per-entry Map and Set changes, and diffs between any two states.
- **Redaction in the page**, before anything is sent. Keys ending in `token`, `password`, `secret`, `apiKey`, `cookie` and similar are redacted by default.
- **Pause and resume, commit, reset, export and import**, plus a scrubber with back to start, previous, next and back to latest.
- **Late-mount safe.** Open the panel whenever you like and it syncs the full history.
- **Development only by default**, like TanStack's own plugins (see [Production](#production)).

> Status: prototype (0.1.0). TanStack Devtools is still alpha (0.x), so the peer range is pinned to `0.16.x`.

## Install

```bash
npm i zustand-inspector
npm i -D @tanstack/devtools          # or @tanstack/react-devtools for React
```

The panel renders with React 19 and [Astryx](https://astryx.atmeta.com), Meta's design system, inside a shadow root, so neither its styles nor your app's can reach the other side. `react` and `react-dom` are peer dependencies (npm and pnpm install them for you); the app itself doesn't need to use React.

## Usage

### 1. Record your stores

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

For a store you can't wrap (a third-party one, say), `inspectStore(store, { name })` records every change as `setState` and still supports time travel.

### 2. Add the plugin

**Any framework, or none**, with the framework-independent host:

```ts
import { TanStackDevtoolsCore } from '@tanstack/devtools'
import { zustandInspectorDevtoolsPlugin } from 'zustand-inspector'

new TanStackDevtoolsCore({ plugins: [zustandInspectorDevtoolsPlugin()] }).mount(container)
```

**React**, with `@tanstack/react-devtools`:

```tsx
import { TanStackDevtools } from '@tanstack/react-devtools'
import { zustandInspectorDevtoolsPlugin } from 'zustand-inspector/react'

<TanStackDevtools plugins={[zustandInspectorDevtoolsPlugin()]} />
```

`ZustandInspectorDevtoolsPanel` (from `zustand-inspector/react`) is the same panel as a component, for a custom plugin entry or your own layout. `ZustandInspectorDevtoolsCore` (from `zustand-inspector`) is the core class (`mount(el, props)` / `unmount()`) that adapters for other frameworks can wrap with `@tanstack/devtools-utils` (`createSolidPanel`, `createVuePanel`…).

The panel is loaded with a dynamic `import()` the first time it mounts, so store code that only imports `inspector` never pulls in React or Astryx.

### Options

`zustandInspectorDevtoolsPlugin(options)` (framework-agnostic) and `ZustandInspectorDevtoolsPanel` props take:
- `astryxTheme: { theme, css }`: any built Astryx theme, so the devtools match your app.
- `loadFonts: true`: load the theme's web font from Google Fonts at page level.
- `asyncConvention`: how async calls are read from action names (see [Async calls](#who-changed-this-and-what-did-it-cost)), or `false`.
- `name`, `id`, `defaultOpen` (plugin only): the tab title (default "Zustand"), the plugin id (default `zustand-inspector`) and whether it opens first.

### Production

As in TanStack's guides, the plain imports are on only when `process.env.NODE_ENV === 'development'`:
- `inspector` and `inspectStore` don't record;
- `zustandInspectorDevtoolsPlugin` and `ZustandInspectorDevtoolsCore` (and the React exports) are no-ops, and your bundler drops the panel.

To keep the devtools in a production build (a staging build, say), import from `zustand-inspector/production` and `zustand-inspector/react/production` instead. These always record, and use the always-on client from `@tanstack/devtools-event-client/production`.

### Build notes

- **CSS target.** Astryx colors rely on CSS `light-dark()`, so a bundler's `build.cssTarget` must be at least Chrome 123 / Safari 17.5 / Firefox 120. Older targets rewrite every theme color into a fallback that only works in dark mode.
- **Root sync.** Astryx's `<Theme>` normally writes `data-theme` onto your `<html>`. The panel uses its own theme root, so your page is never touched.
- **React StrictMode.** `@tanstack/devtools-utils`' `createReactPanel` misses prop changes under React 19's StrictMode (its ref is detached before the simulated unmount, so later effects return early), so the panel never sees a theme change. `zustand-inspector/react` uses its own panel component with the same contract instead, and still builds the plugin with `createReactPlugin`.

### Who changed this, and what did it cost?

The Astryx panel answers the two questions a state log usually can't.

- **Search inside state.** The State tab filters the tree by key or value and opens the matching branches.
- **Path history.** Click any key in the tree to see:
  - its value at the selected action
  - the action that last changed it
  - every recorded action that touched it, with before and after values
- **Pin a path.** "Pin path" narrows the action list, the state tree and the diff to that path.
- **Compare two states.** Click Compare, then pick the initial state and the final state. A banner says which step you're on, the two actions are tagged From and To, the actions in between are tinted, and the detail header names both ends. Shift-click a second action does the same in one step; while Shift is held, the selected action shows its From tag.
- **Cost per action.** The `inspector` middleware times each `set()` including the store's synchronous listeners, and counts the listeners it notified. The Action tab shows the time, listeners, state size and findings. The list flags:
  - **slow:** longer than a frame (16 ms)
  - **no-op:** a new state object with no changed value, so every listener ran for nothing
  - **same value:** a key got a new reference with an equal value, so selectors reading it re-render

  The Slow and Wasted filters show only those actions. The toolbar shows the current state size.
- **Functions.** With the Functions switch on, a store's functions appear next to their keys with their parameters, for example `setStep: (step) => {…}` or `load: async () => {…}`. Only the parameter list is read from the page, and string default values are replaced with `"…"`.
- **Chrome Performance panel.** Timed actions also appear on a "Zustand" track, through `console.timeStamp`. Turn it off with `performanceTrack: false`.
- **Async calls.** Actions named by Redux Toolkit's phase convention collapse into one row per call: `todos/load:pending`, then `todos/load:fulfilled` or `todos/load:rejected` (`/pending` works too). The row shows whether the call is running, fulfilled or rejected, and how long it took. Expand it to see its actions. Click it to diff the whole call, and its Action tab shows the start, the end, the request id and the error. Put a `requestId` in the payload (or in `payload.meta`) so overlapping calls pair exactly. Without one, overlapping calls are paired oldest-first and marked "ambiguous". Grouping only reads names, so nothing is wrapped at runtime. A team with other names passes `asyncConvention: (name, payload) => ({ key, phase, requestId }) | null` to the plugin, or `false` to turn grouping off.

  ```ts
  load: async () => {
    const requestId = crypto.randomUUID()
    set({ status: 'loading' }, false, { type: 'todos/load:pending', requestId })
    try {
      const todos = await api.todos()
      set({ todos, status: 'ready' }, false, { type: 'todos/load:fulfilled', requestId })
    } catch (error) {
      set({ status: 'error' }, false, { type: 'todos/load:rejected', requestId, error })
    }
  },
  ```
- **History branches.** Changing state while viewing the past discards the actions after that state, like undo/redo. The new action shows "from #N".

Notes:
- Path history comes from the per-action diffs, so it can miss changes in an action that changed more than 200 values (the panel says so).
- `inspectStore()` stores record states but can't be timed, because their actions call `set` directly.

### Zustand's built-in middlewares

Put `inspector` outermost, the same place Zustand's docs put `devtools`:

```ts
createStore<State>()(inspector(persist(immer((set) => ({ … })), { name: 'cart' }), { name: 'cart' }))
```

The toolbar's **Middlewares** button (with a count, and a dot when one needs attention, such as `persist` still hydrating) lists the middlewares found on the store, each by its real name with one line on what it does and its status. Click one for its details. The store selector lists each store's middlewares too.

- **`persist`.** The dialog shows:
  - whether the store has hydrated, the storage key, the version, and the keys `partialize` keeps;
  - the stored value, and whether it matches the current state (if not, what differs);
  - a note when the stored version differs from the store's, because `migrate` will run on the next rehydrate.

  Buttons rehydrate from storage or clear it. Rehydration is recorded as `persist/rehydrate`, including with `skipHydration` and async storage.
- **`redux`.** The dialog shows how many actions were dispatched and their types, and has a **Dispatch** box: type an action as JSON and run it through the reducer. The last dispatched action is the placeholder. Dispatched actions keep their `type` and payload in the action list.
- **`subscribeWithSelector`.** The "subscriptions" dialog lists every selector subscription with its selector, its equality function, `fireImmediately`, how many times its listener fired, and on which action it last did. Listener counts in the cost data include these subscriptions.
- **`immer`** and **`devtools`** get a marker. Names are still inferred through immer's `setState` wrapper, even when it's bundled into the app. `immer` is detected from the wrapper's source, so only in unminified builds.
- **`combine`** leaves no trace on the store, so there's nothing to detect.
- **Order mistakes are caught.** If a middleware wraps the inspector (`persist(inspector(…))`), its own writes skip `inspector`'s `set`. The inspector still records them, as `persist/rehydrate` or `setState (outside inspector)`, and still finds the middleware.
- **`inspectStore`** finds the same middlewares.

These are built on an integration API (`InspectorIntegration`, experimental) that any middleware can implement: `detect` it on the store, describe its `status` and `facts`, `inspect` what it holds, offer `commands`, and name the `set()` calls it makes (`writing`). Pass `integrations: [...builtInIntegrations, mine]` to `inspector` or `inspectStore`.

Name inference skips frames from `node_modules` and Vite's prebundled deps, which is what dev servers serve, and wrappers named `setState`. In a build that bundles Zustand into the same file as your code, pass action names explicitly when using `persist`.

To host a panel outside TanStack (a plain `<div>`, an extension page, a Vite DevTools dock), mount the core yourself: `new ZustandInspectorDevtoolsCore().mount(el, { theme: 'dark' })`. `zustand-inspector/plain` also has a smaller panel in plain DOM, with no React: `mountInspector(el, { transport })`.

## Options

| Option | Default | |
|---|---|---|
| `name` | required | Store id shown in the panel. Re-registering the same name replaces the old store (HMR). |
| `maxHistory` | `100` | Ring-buffer size. Older actions are dropped, and the panel shows how many. |
| `redact` | `true` | `true`, `false`, a `RegExp` or `(key, path) => boolean`. |
| `sanitize` | none | `(state) => unknown` to hide or reshape state before it is serialized. |
| `maxDepth` / `maxItems` | `12` / `500` | Serialization limits. |
| `diff` | `true` | Compute per-action structural diffs. |
| `enabled` | development only | Force recording on or off (`zustand-inspector/production` defaults to on). |
| `inferActionName` | `true` | Infer the action name from the calling function's name. |
| `anonymousActionType` | `'anonymous'` | Name used when nothing else is known. |
| `transport` | TanStack bus | Any object implementing `Transport`. |
| `performanceTrack` | `true` | Add timed actions to a "Zustand" track in Chrome's Performance panel. |

## How it works

```
 page                                              devtools (any TanStack host)
 ┌──────────────────────────────┐ EventClient     ┌──────────────────────────────┐
 │ inspector middleware          │ 'zustand-       │ ZustandInspectorDevtoolsCore  │
 │  └ StoreRecorder              │  inspector:*'   │  └ panel (React + Astryx,     │
 │     ring buffer of ORIGINAL   │◀─ commands ─────│     shadow root, lazy-loaded) │
 │     states, ids, diffs        │── events ──────▶│  plugin · React adapter       │
 └──────────────────────────────┘   by id         └──────────────────────────────┘
```

- **The page owns the state.** The panel only receives serialized, redacted views. It never sends state back to time travel; it sends `{ type: 'jump', toId }`, and the page restores the exact object it recorded. `import` is the only command that carries state. It is rebuilt on top of the live state, so actions and redacted secrets keep their live values, and it is logged as `devtools/import`.
- **Versioned envelope.** Every message carries `{ v, session }`. The TanStack bus mirrors events to other tabs over BroadcastChannel, so the session id stops a panel in one tab from jumping stores in another.
- **Swappable transport.** The recorder and panel depend only on `Transport { send, on, reconnect? }`. Two are included: the `ZustandInspectorEventClient` (an `EventClient` subclass, plugin id `zustand-inspector`, suffix-only event names) and an in-memory one. A `postMessage`, WebSocket or Rozenite transport can be added without touching either side.
- **TanStack quirks it handles:**
  - `render(el, props)` runs again on every theme or open change, and adapters unmount and mount again on every prop change, so the core keeps one panel per container and only switches its theme.
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
- The plain DOM panel shows async calls as separate rows; grouping is in the Astryx panel.
- Not yet: editing state from the panel, a subscriber/selector view, go-to-source, agent (MCP) tools.
- State editing from the panel, a "why did this subscriber run" view, and go-to-source for actions (from the stack trace) aren't built yet.
- Other hosts: a Redux DevTools adapter (so existing users keep their workflow), a WXT browser extension, Rozenite (React Native), and command endpoints that MCP-based coding agents can call.

## Marketplace

The entry for TanStack Devtools' [plugin registry](https://tanstack.com/devtools/latest/docs/third-party-plugins) (`packages/devtools/src/tabs/plugin-registry.ts`), once the package is on npm. The root plugin works in every host, so one entry covers all frameworks:

```ts
'zustand-inspector': {
  packageName: 'zustand-inspector',
  title: 'Zustand Inspector',
  description: 'Time travel, diffs, per-action cost, async calls and middleware views (persist, redux…) for Zustand stores.',
  requires: { packageName: 'zustand', minVersion: '5.0.0' },
  pluginImport: { importName: 'zustandInspectorDevtoolsPlugin', type: 'function' },
  pluginId: 'zustand-inspector',
  docsUrl: 'https://github.com/dbritto-dev/zustand-inspector#readme',
  repoUrl: 'https://github.com/dbritto-dev/zustand-inspector',
  author: 'Danilo Britto',
  framework: 'other',
  tags: ['Zustand', 'state management', 'time travel'],
},
```

## Development

Uses [pnpm](https://pnpm.io) (the version is pinned in `package.json`'s `packageManager`; `corepack enable` picks it up).

```bash
pnpm install
pnpm dev                 # the playground (vanilla TanStackDevtoolsCore) at http://localhost:5173
pnpm dev:react           # the React example (@tanstack/react-devtools)
pnpm test                # vitest
pnpm typecheck
pnpm build               # dist/ (ESM) + dist/types
pnpm build:examples      # dist-examples/vanilla and dist-examples/react as static pages
pnpm astryx doctor --built src/astryx   # Astryx usage check for the panel
```

CI (`.github/workflows/ci.yml`) runs the typecheck, the tests, both builds and the Astryx check on every PR and push to `main`.

## Releasing

Releases use [Changesets](https://github.com/changesets/changesets) and publish to npm from GitHub Actions with [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no stored npm token, with provenance):

1. With a change that should ship, run `pnpm changeset`, pick the bump and describe the change. Commit the generated file.
2. When it lands on `main`, `.github/workflows/release.yml` opens or updates a "chore: version packages" PR that bumps the version and writes `CHANGELOG.md`.
3. Merging that PR publishes the new version to npm, tags it and creates a GitHub release.

One-time setup: on npmjs.com, the package's *Settings → Trusted publishing* names the repository `dbritto-dev/zustand-inspector` and the workflow `release.yml`; on GitHub, *Settings → Actions → General* allows GitHub Actions to create pull requests.
