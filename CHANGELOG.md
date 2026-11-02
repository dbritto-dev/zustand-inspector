# zustand-inspector

## 0.1.2

### Patch Changes

- 6fe8044: The framework-agnostic `zustandInspectorDevtoolsPlugin` from `zustand-inspector` now type-checks in `@tanstack/react-devtools` (and the Preact and Solid adapters): its `render` no longer declares a `void` return, which those adapters reject. This is how TanStack's marketplace adds the plugin to React apps.

## 0.1.1

### Patch Changes

- c9a328c: First release published from CI with npm trusted publishing and provenance. The README covers installing, the framework-agnostic and React plugins, production builds, and releasing.
