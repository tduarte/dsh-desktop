#!/usr/bin/env node
/**
 * Pack the Linux tarball WITHOUT electron-builder.
 *
 * electron-builder 26's `nodeModulesCollector` walks the entire
 * node_modules/ tree via `pnpm list --json`, which OOMs on every CI runner
 * we have access to (~865 hoisted packages materializing as one giant JSON
 * object). The collector is hardcoded: there is no env var or config key
 * to skip it in v26.x. Pivoting off electron-builder for Linux entirely.
 *
 * Output:
 *   dist/DeepSeek-Harness-<version>-linux-x64.tar.gz
 *     - DeepSeek Harness-linux-x64/
 *       - electron-app/      (Electron binary + lib/main.cjs + lib/preload.cjs)
 *       - resources/dsh/     (bundled CLI)
 *       - resources/dist/    (frontend Vite output)
 *
 * The flatpak manifest references this tarball under `extra-data`. See
 * flatpak/ai.deepseek.harness.desktop.yml.
 */

import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(repoRoot, 'dist')
const stageRoot = join(repoRoot, 'build', 'stage')

const electronSource = join(repoRoot, 'node_modules', 'electron', 'dist')
const libSource = join(repoRoot, 'lib')
const stageDshSource = join(stageRoot, 'dsh')
const stageDistSource = join(stageRoot, 'dist')

const version = (await import(join(repoRoot, 'package.json'), { with: { type: 'json' } })).default.version
const tarballName = `DeepSeek-Harness-${version}-linux-x64.tar.gz`

function fail(message) {
  process.stderr.write(`pack-linux: ${message}\n`)
  process.exit(1)
}

async function assertExists(path, label) {
  if (!existsSync(path)) fail(`${label} not found at ${path}; did you run \`pnpm run build\`?`)
}

async function main() {
  await assertExists(electronSource, 'Electron dist')
  await assertExists(libSource, 'lib/')
  await assertExists(stageDshSource, 'bundled CLI stage')
  await assertExists(stageDistSource, 'bundled frontend stage')

  // Stage a directory that mirrors what electron-builder would have produced.
  const stagingRoot = join(distDir, 'DeepSeek Harness-linux-x64')
  if (existsSync(stagingRoot)) await rm(stagingRoot, { recursive: true, force: true })
  await mkdir(join(stagingRoot, 'electron-app', 'node_modules', 'electron'), { recursive: true })
  await mkdir(join(stagingRoot, 'electron-app', 'node_modules', 'app-builder-lib'), { recursive: true })
  await mkdir(join(stagingRoot, 'electron-app', 'lib'), { recursive: true })
  await mkdir(join(stagingRoot, 'resources', 'dsh'), { recursive: true })
  await mkdir(join(stagingRoot, 'resources', 'dist'), { recursive: true })

  process.stdout.write('pack-linux: copying Electron distribution\n')
  await cp(electronSource, join(stagingRoot, 'electron-app', 'node_modules', 'electron', 'dist'), {
    recursive: true,
    dereference: true,
  })
  // Copy only the runtime bits Electron actually loads. The full Electron
  // dist (Frameworks, Helpers, *.so) is ~280 MB; this is what an end user
  // would download anyway.
  await cp(join(repoRoot, 'node_modules', 'electron', 'package.json'),
           join(stagingRoot, 'electron-app', 'node_modules', 'electron', 'package.json'))

  process.stdout.write('pack-linux: copying compiled main.cjs + preload.cjs\n')
  await cp(libSource, join(stagingRoot, 'electron-app', 'lib'), {
    recursive: true,
    dereference: true,
  })

  process.stdout.write('pack-linux: copying bundled CLI + frontend\n')
  await cp(stageDshSource, join(stagingRoot, 'resources', 'dsh'), {
    recursive: true,
    dereference: true,
  })
  await cp(stageDistSource, join(stagingRoot, 'resources', 'dist'), {
    recursive: true,
    dereference: true,
  })

  // Generate a minimal package.json that points main at lib/main.cjs.
  const pkg = {
    name: '@deepseek-ai/dsh-desktop',
    version,
    main: 'lib/main.cjs',
  }
  const { writeFile } = await import('node:fs/promises')
  await writeFile(
    join(stagingRoot, 'electron-app', 'package.json'),
    JSON.stringify(pkg, null, 2),
  )

  process.stdout.write('pack-linux: creating tarball (gzip)\n')
  await mkdir(distDir, { recursive: true })
  const tarPath = join(distDir, tarballName)
  if (existsSync(tarPath)) await rm(tarPath, { force: true })
  // BSD tar (macOS) and GNU tar both accept `-czf <archive> -C <dir> <entry>`.
  // The staging directory's literal name "DeepSeek Harness-linux-x64" is
  // preserved inside the tarball; no --transform needed.
  await new Promise((resolveProm, rejectProm) => {
    const tar = spawn('tar', [
      '-czf',
      tarPath,
      '-C', distDir,
      'DeepSeek Harness-linux-x64',
    ], { stdio: 'inherit' })
    tar.once('error', rejectProm)
    tar.once('close', (code) => {
      if (code === 0) resolveProm()
      else rejectProm(new Error(`tar exited ${code ?? 'null'}`))
    })
  })
  const s = await stat(tarPath)
  process.stdout.write(`pack-linux: wrote ${tarballName} (${Math.round(s.size / 1024)} KB)\n`)
  process.stdout.write('pack-linux: done\n')
}

await main()