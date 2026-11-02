import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Builds one example as a single static page: `--mode vanilla` (the playground,
// also published as an artifact) or `--mode react`.
export default defineConfig(({ mode }) => {
  const example = mode === 'react' ? 'react' : 'vanilla'
  return {
    root: resolve(import.meta.dirname, 'examples', example),
    base: './',
    define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    build: {
      outDir: resolve(import.meta.dirname, `dist-examples/${example}`),
      emptyOutDir: true,
      target: 'es2022',
      // Astryx themes use CSS light-dark(); an older CSS target rewrites it into a dark-only fallback.
      cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'],
      modulePreload: false,
      // Compressed but not mangled, so the demo stores' functions keep readable
      // parameter names (devtools normally run against unminified dev builds).
      minify: false,
      // The artifact host only allows font files from Google Fonts or data: URIs,
      // so TanStack's bundled fonts are inlined.
      assetsInlineLimit: 512 * 1024,
      rolldownOptions: { output: { codeSplitting: false, minify: { compress: true, mangle: false } } },
    },
  }
})
