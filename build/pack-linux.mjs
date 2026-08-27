#!/usr/bin/env node
/**
 * Pack the Linux tarball WITHOUT electron-builder.
 *
 * electron-builder 26's `nodeModulesCollector` walks the entire
 * node_modules/ tree via `pnpm list --json`, which OOMs on every CI runner
 * we have access to (~865 hoisted packages materializing as one giant JSON
 * object). The collector is hardcoded: there is no env var or config key
 * to skip it in v26.x. Pivoting off electron-builder for Linux entirely.
 * Output:
 *   dist/DeepSeek-Harness-<version>-linux-x64.tar.gz
 *     - DeepSeek Harness-linux-x64/
 *       - electron-app/node_modules/electron/dist/
 *         - dsh-desktop         (Electron binary, renamed so app.isPackaged is true)
 *         - resources/app/      (package.json + lib/main.cjs + lib/preload.cjs)
 *         - resources/dsh/      (bundled CLI)
 *         - resources/dist/     (frontend Vite output)
 *
 * Electron computes process.resourcesPath as <exe_dir>/resources and
 * app.isPackaged from the executable basename (must not be "electron"),
 * so src/main.ts#resolveDshBin() resolves resources/dsh/lib/bin.js.
 * The flatpak manifest extracts this tarball at build time. See
 * flatpak/io.github.tduarte.dsh-desktop.yml.
 */

import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
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
  // Stage a layout Electron recognizes as "packaged": executable renamed
  // away from "electron" (app.isPackaged === true) and the app payload under
  // <exe_dir>/resources/, matching what electron-builder emits.
  const stagingRoot = join(distDir, 'DeepSeek Harness-linux-x64')
  if (existsSync(stagingRoot)) await rm(stagingRoot, { recursive: true, force: true })
  const electronDist = join(stagingRoot, 'electron-app', 'node_modules', 'electron', 'dist')
  await mkdir(join(electronDist, 'resources', 'app'), { recursive: true })

  process.stdout.write('pack-linux: copying Electron distribution\n')
  await cp(electronSource, electronDist, {
    recursive: true,
    dereference: true,
  })

  // Rename the executable: Electron only treats itself as packaged when the
  // basename is not "electron". This makes process.resourcesPath point at
  // electron-app/node_modules/electron/dist/resources.
  const electronBin = join(electronDist, 'electron')
  const renamedBin = join(electronDist, 'dsh-desktop')
  await rename(electronBin, renamedBin)
  process.stdout.write('pack-linux: renamed electron -> dsh-desktop\n')
  // app payload: package.json + compiled main.cjs/preload.cjs, resolved via
  // process.resourcesPath/app by Electron's packaged-mode loader.
  await cp(libSource, join(electronDist, 'resources', 'app', 'lib'), {
    recursive: true,
    dereference: true,
  })
  const pkg = {
    name: '@deepseek-ai/dsh-desktop',
    version,
    main: 'lib/main.cjs',
  }
  const { writeFile } = await import('node:fs/promises')
  await writeFile(
    join(electronDist, 'resources', 'app', 'package.json'),
    JSON.stringify(pkg, null, 2),
  )

  process.stdout.write('pack-linux: copying bundled CLI + frontend\n')
  await cp(stageDshSource, join(electronDist, 'resources', 'dsh'), {
    recursive: true,
    dereference: true,
  })
  await cp(stageDistSource, join(electronDist, 'resources', 'dist'), {
    recursive: true,
    dereference: true,
  })

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