---
'zustand-inspector': patch
---

The framework-agnostic `zustandInspectorDevtoolsPlugin` from `zustand-inspector` now type-checks in `@tanstack/react-devtools` (and the Preact and Solid adapters): its `render` no longer declares a `void` return, which those adapters reject. This is how TanStack's marketplace adds the plugin to React apps.
