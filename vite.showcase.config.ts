import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Single-file build of the showcase (devtools included) for publishing as a page.
export default defineConfig({
  root: resolve(import.meta.dirname, 'showcase'),
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  build: {
    outDir: resolve(import.meta.dirname, 'dist-showcase'),
    emptyOutDir: true,
    target: 'es2022',
    // Astryx themes use CSS light-dark(); an older CSS target rewrites it into a dark-only fallback.
    cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'],
    modulePreload: false,
    // The artifact host only allows font files from Google Fonts or data: URIs,
    // so TanStack's bundled fonts are inlined.
    assetsInlineLimit: 512 * 1024,
    rolldownOptions: { output: { codeSplitting: false } },
  },
})
