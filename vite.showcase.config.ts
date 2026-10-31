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
    modulePreload: false,
    rolldownOptions: { output: { codeSplitting: false } },
  },
})
