'use strict'
const { defineConfig } = require('tsdown')

// Sandbox preloads can't use relative `require()` to sibling chunks.
// Solution: per-entry config — main allows chunking, preload forces inline.
const mainConfig = defineConfig({
  entry: { main: 'src/main.ts' },
  outDir: 'lib',
  format: 'cjs',
  target: 'node22',
  clean: true,
  sourcemap: true,
  dts: false,
  external: ['electron'],
  noExternal: [/^(electron-updater|builder-util|builder-util-runtime|app-builder-lib|dmg-builder|electron-builder|js-yaml|lazy-val|semver|lodash\..*)$/],
})

const preloadConfig = defineConfig({
  entry: { preload: 'src/preload.ts' },
  outDir: 'lib',
  format: 'cjs',
  target: 'node22',
  clean: false,
  sourcemap: true,
  dts: false,
  // Inline everything; no shared chunks. Sandboxed preloads can't resolve
  // relative paths to sibling chunks.
  external: ['electron'],
  noExternal: true,
})

module.exports = [mainConfig, preloadConfig]