import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// `vite` / `vite build --mode demo` serve and build the demo app.
// `vite build` (library mode) builds the package itself.
export default defineConfig(({ command, mode }) => {
  if (command === 'serve' || mode === 'demo') {
    return {
      root: resolve(import.meta.dirname, 'demo'),
      build: { outDir: resolve(import.meta.dirname, 'dist-demo'), emptyOutDir: true, target: 'es2022', cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'] },
    }
  }
  return {
    build: {
      target: 'es2022',
      // Astryx themes use CSS light-dark(); an older CSS target rewrites it into a dark-only fallback.
      cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'],
      sourcemap: true,
      lib: {
        entry: {
          index: resolve(import.meta.dirname, 'src/index.ts'),
          panel: resolve(import.meta.dirname, 'src/panel/index.ts'),
          astryx: resolve(import.meta.dirname, 'src/astryx/index.ts'),
        },
        formats: ['es'],
      },
      rolldownOptions: {
        // Peers stay external; Astryx stylesheets imported with ?inline are bundled as strings.
        external: (id) =>
          !id.includes('?inline') &&
          /^(zustand|react|react-dom|lucide-react|@tanstack\/|@astryxdesign\/|@stylexjs\/)/.test(id),
      },
    },
  }
})
