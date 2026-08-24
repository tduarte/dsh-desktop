#!/usr/bin/env node
/**
 * Stage the upstream `@deepseek-ai/dsh` (CLI + bundled webserver) and
 * `@deepseek-ai/dsh-web-frontend` (Vite dist) into `build/stage/` so the
 * packaged Electron app can `spawn` them as a child process.
 *
 * Strategy:
 *   1. Run `npm install` in a fresh temp dir with `@deepseek-ai/dsh` and
 *      `@deepseek-ai/dsh-web-frontend` declared as direct deps. npm hoists
 *      peer dependencies natively, so the resulting tree is self-contained.
 *      (pnpm's `deploy --legacy` skips peer deps and the `pnpm deploy`
 *      workspace mode is opt-in — npm is simpler and correct.)
 *   2. Copy `node_modules/@deepseek-ai/dsh/{lib,config,package.json}` plus
 *      the entire `node_modules/` (peer deps) into `build/stage/dsh/`.
 *   3. Copy `node_modules/@deepseek-ai/dsh-web-frontend/dist/` into
 *      `build/stage/dist/`.
 *
 * Why we don't ship dsh-web-frontend's deps: the frontend is a built Vite
 * dist (static assets only); nothing in the desktop runs its source.
 */

import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
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

/**
 * Run `npm install --omit=dev` in a fresh temp dir to materialize a self-contained
 * dependency closure of `@deepseek-ai/dsh`. Returns the path of the install root.
 */
async function npmInstallDsh() {
  const stage = join(repoRoot, 'build', '.npm-stage')
  await rm(stage, { recursive: true, force: true })
  await mkdir(stage, { recursive: true })
  await writeFile(join(stage, 'package.json'), JSON.stringify({
    name: 'dsh-stage',
    version: '0.0.0',
    private: true,
    dependencies: {
      '@deepseek-ai/dsh': '0.1.1-rc.2',
    },
  }, null, 2))
  const result = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: stage,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    fail(`npm install exited with code ${String(result.status ?? result.signal)}`)
  }
  return stage
}

async function main() {
  await assertExists(cliSource, '@deepseek-ai/dsh package directory')
  await assertExists(webSource, '@deepseek-ai/dsh-web-frontend/dist')
  await assertExists(join(cliSource, 'lib', 'bin.js'), 'CLI bin.js')
  await assertExists(join(webSource, 'index.html'), 'web frontend index.html')

  await mkdir(stageRoot, { recursive: true })

  process.stdout.write('bundle-dsh: npm install @deepseek-ai/dsh (resolves peer deps)\n')
  const stage = await npmInstallDsh()
  const stagedNodeModules = join(stage, 'node_modules')

  if (existsSync(stageDsh)) await rm(stageDsh, { recursive: true, force: true })
  await mkdir(stageDsh, { recursive: true })
  process.stdout.write('bundle-dsh: copying CLI into build/stage/dsh\n')
  await cp(join(stagedNodeModules, '@deepseek-ai', 'dsh'), stageDsh, {
    recursive: true,
    dereference: true,
  })
  await cp(stagedNodeModules, join(stageDsh, 'node_modules'), {
    recursive: true,
    dereference: true,
  })
  await rm(stage, { recursive: true, force: true })

  process.stdout.write('bundle-dsh: staging web dist → build/stage/dist\n')
  if (existsSync(stageDist)) await rm(stageDist, { recursive: true, force: true })
  await mkdir(stageDist, { recursive: true })
  await cp(webSource, stageDist, { recursive: true, dereference: true })

  await writeFile(join(stageDsh, '.dependencies-installed'), new Date().toISOString())
  process.stdout.write('bundle-dsh: done\n')
}

await main()