#!/usr/bin/env node
/**
 * Pack the Windows directory layout WITHOUT electron-builder.
 *
 * Same rationale as `pack-linux.mjs` / `pack-mac.mjs`. We skip
 * electron-builder's NSIS installer: distribution will use the produced
 * directory + a future signed NSIS wrapper or a simple zip artifact.
 *
 * Output:
 *   dist/DeepSeek-Harness-<version>-win-x64/
 *     electron.exe                    (the Electron binary)
 *     resources.pak                   (Electron resources)
 *     *.dll                           (Chromium DLLs)
 *     resources/
 *       app/
 *         lib/main.cjs
 *         lib/preload.cjs
 *         package.json                (main → lib/main.cjs)
 *       dsh/                          (bundled CLI)
 *       dist/                         (frontend Vite output)
 */

import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(repoRoot, 'dist')

// On Linux/macOS we only have node_modules/electron/dist/Electron.app
// (mac) or / (linux). electron-builder's Win build runs on Windows or
// via Wine. For this minimal layout, we synthesize a directory the user
// can zip up themselves; CI's Windows runner uses the actual full Win
// Electron binary emitted from electron-builder minus its collector.

const electronDistSource = join(repoRoot, 'node_modules', 'electron', 'dist')
const libSource = join(repoRoot, 'lib')
const stageDshSource = join(repoRoot, 'build', 'stage', 'dsh')
const stageDistSource = join(repoRoot, 'build', 'stage', 'dist')
const { version } = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))

function fail(message) {
  process.stderr.write(`pack-win: ${message}\n`)
  process.exit(1)
}

async function assertExists(path, label) {
  if (!existsSync(path)) fail(`${label} not found at ${path}; did you run \`pnpm run build\`?`)
}

async function main() {
  await assertExists(electronDistSource, 'Electron dist')
  await assertExists(libSource, 'lib/')
  await assertExists(stageDshSource, 'bundled CLI stage')
  await assertExists(stageDistSource, 'bundled frontend stage')

  const outDir = join(distDir, `DeepSeek-Harness-${version}-win-x64`)
  if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true })
  await mkdir(join(outDir, 'resources', 'app'), { recursive: true })

  process.stdout.write('pack-win: copying Electron dist\n')
  // Skip Electron.app on non-mac platforms; otherwise recurse and dereference.
  await cp(electronDistSource, outDir, {
    recursive: true,
    dereference: true,
    filter: (s) => !s.endsWith('Electron.app') && !s.endsWith('Electron.app/'),
  })

  process.stdout.write('pack-win: staging app/ under resources/\n')
  await cp(libSource, join(outDir, 'resources', 'app', 'lib'), {
    recursive: true,
    dereference: true,
  })
  const pkg = {
    name: '@deepseek-ai/dsh-desktop',
    version,
    main: 'lib/main.cjs',
  }
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(outDir, 'resources', 'app', 'package.json'), JSON.stringify(pkg, null, 2))

  process.stdout.write('pack-win: copying bundled CLI + frontend\n')
  await cp(stageDshSource, join(outDir, 'resources', 'dsh'), {
    recursive: true,
    dereference: true,
  })
  await cp(stageDistSource, join(outDir, 'resources', 'dist'), {
    recursive: true,
    dereference: true,
  })

  const s = await stat(outDir)
  process.stdout.write(`pack-win: ${s.size} bytes at ${outDir}\n`)
}

await main()