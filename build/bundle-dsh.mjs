#!/usr/bin/env node
/**
 * Stage the upstream `@deepseek-ai/dsh` (CLI + bundled webserver) and
 * `@deepseek-ai/dsh-web-frontend` (Vite dist) into `build/stage/` so the
 * packaged Electron app can `spawn` them as a child process.
 *
 * Source-of-truth layout:
 *   node_modules/@deepseek-ai/dsh/                          (CLI package)
 *   node_modules/@deepseek-ai/dsh-web-frontend/dist/       (frontend dist)
 *
 * Outputs:
 *   build/stage/dsh/lib/bin.js          (CLI entry)
 *   build/stage/dsh/node_modules/...    (full transitive dep closure)
 *   build/stage/dist/index.html         (frontend entry)
 *
 * Strategy:
 *   We rely on the project's `.npmrc` (node-linker=hoisted +
 *   shamefully-hoist=true + auto-install-peers=true) to produce a flat
 *   `node_modules/` tree at install time. The transitive peer-dep closure
 *   (`@deepseek-ai/cordis-plugin-*`, `@deepseek-ai/dsh-*` workspace
 *   packages) is already resolved into the workspace root, so we just copy
 *   it. This avoids the previous `npm install` round-trip (which took 6+
 *   minutes on cold CI runners).
 *
 * Failure mode: abort with a non-zero exit on any missing artifact.
 */

import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..')
const stageRoot = join(repoRoot, 'build', 'stage')
const stageDsh = join(stageRoot, 'dsh')
const stageDist = join(stageRoot, 'dist')

const cliSource = join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh')
const webSource = join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist')

function fail(message) {
  process.stderr.write(`bundle-dsh: ${message}\n`)
  process.exit(1)
}

async function assertExists(path, label) {
  if (!existsSync(path)) {
    fail(`${label} not found at ${path}; did you run \`pnpm install\`?`)
  }
}

async function main() {
  await assertExists(cliSource, '@deepseek-ai/dsh package directory')
  await assertExists(webSource, '@deepseek-ai/dsh-web-frontend/dist')
  await assertExists(join(cliSource, 'lib', 'bin.js'), 'CLI bin.js')
  await assertExists(join(webSource, 'index.html'), 'web frontend index.html')

  await mkdir(stageRoot, { recursive: true })

  if (existsSync(stageDsh)) await rm(stageDsh, { recursive: true, force: true })
  process.stdout.write('bundle-dsh: copying CLI into build/stage/dsh\n')
  await cp(cliSource, stageDsh, {
    recursive: true,
    dereference: true,
  })

  process.stdout.write('bundle-dsh: copying flat node_modules closure\n')
  const nodeModulesSource = join(repoRoot, 'node_modules')
  await cp(nodeModulesSource, join(stageDsh, 'node_modules'), {
    recursive: true,
    dereference: true,
    filter: (source) => {
      // Drop caches and bins that aren't runtime-relevant.
      if (source.includes(`${sep}.bin${sep}`)) return false
      if (source.includes(`${sep}.cache${sep}`)) return false
      if (source.includes(`${sep}.pnpm-store${sep}`)) return false
      if (source.includes(`${sep}.modules.yaml`)) return false
      if (source.includes(`${sep}node_modules${sep}.pnpm${sep}`)) return false
      return true
    },
  })

  process.stdout.write('bundle-dsh: staging web dist → build/stage/dist\n')
  if (existsSync(stageDist)) await rm(stageDist, { recursive: true, force: true })
  await mkdir(stageDist, { recursive: true })
  await cp(webSource, stageDist, { recursive: true, dereference: true })

  await writeFile(join(stageDsh, '.dependencies-installed'), new Date().toISOString())
  process.stdout.write('bundle-dsh: done\n')
}

const sep = (await import('node:path')).sep
await main()