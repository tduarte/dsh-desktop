'use strict'
const { defineConfig } = require('tsdown')

module.exports = defineConfig({
  entry: {
    main: 'src/main.ts',
    preload: 'src/preload.ts',
  },
  outDir: 'lib',
  format: 'cjs',
  target: 'node22',
  clean: true,
  sourcemap: true,
  dts: false,
})