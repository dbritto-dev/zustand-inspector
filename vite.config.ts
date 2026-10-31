import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// `vite` / `vite build --mode demo` serve and build the demo app.
// `vite build` (library mode) builds the package itself.
export default defineConfig(({ command, mode }) => {
  if (command === 'serve' || mode === 'demo') {
    return {
      root: resolve(import.meta.dirname, 'demo'),
      build: { outDir: resolve(import.meta.dirname, 'dist-demo'), emptyOutDir: true, target: 'es2022' },
    }
  }
  return {
    build: {
      target: 'es2022',
      sourcemap: true,
      lib: {
        entry: {
          index: resolve(import.meta.dirname, 'src/index.ts'),
          panel: resolve(import.meta.dirname, 'src/panel/index.ts'),
        },
        formats: ['es'],
      },
      rolldownOptions: {
        external: [/^zustand/, /^@tanstack\//],
      },
    },
  }
})
