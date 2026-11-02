import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const src = (path: string) => resolve(import.meta.dirname, 'src', path)

// `vite` serves the vanilla playground (`--mode react` the React example).
// `vite build` (library mode) builds the package itself.
export default defineConfig(({ command, mode }) => {
  if (command === 'serve') {
    return { root: resolve(import.meta.dirname, 'examples', mode === 'react' ? 'react' : 'vanilla') }
  }
  return {
    build: {
      target: 'es2022',
      // Astryx themes use CSS light-dark(); an older CSS target rewrites it into a dark-only fallback.
      cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'],
      sourcemap: true,
      minify: false,
      lib: {
        entry: {
          index: src('index.ts'),
          production: src('production.ts'),
          'react/index': src('react/index.ts'),
          'react/production': src('react/production.ts'),
          plain: src('panel/index.ts'),
        },
        formats: ['es'],
      },
      rolldownOptions: {
        // The React entries start with 'use client' and are their own entry
        // chunks, so the directive is kept (checked in dist/react/*.js).
        onwarn(warning, warn) {
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return
          warn(warning)
        },
        // Dependencies and peers stay external; Astryx stylesheets imported with
        // ?inline are bundled as strings.
        external: (id) =>
          !id.includes('?inline') &&
          /^(zustand|react|react-dom|lucide-react|@tanstack\/|@astryxdesign\/|@stylexjs\/)/.test(id),
        output: {
          chunkFileNames: 'chunks/[name]-[hash].js',
        },
      },
    },
  }
})
