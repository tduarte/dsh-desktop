#!/usr/bin/env node
/**
 * Pack the macOS .app bundle WITHOUT electron-builder.
 *
 * Same rationale as `pack-linux.mjs`: electron-builder's `nodeModulesCollector`
 * OOMs on CI runners with this repo's ~865 hoisted packages.
 *
 * Output:
 *   dist/DeepSeek Harness.app/Contents/
 *     MacOS/Electron                  (Electron binary, renamed for our app)
 *     Frameworks/Electron Helper...   (Chromium helpers)
 *     Resources/
 *       app/
 *         lib/main.cjs
 *         lib/preload.cjs
 *         package.json                (points main → lib/main.cjs)
 *       dsh/                          (bundled CLI; spawn-path target)
 *       dist/                         (frontend Vite output)
 */

import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { chmod, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(repoRoot, 'dist')

const electronAppSource = join(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app')
const libSource = join(repoRoot, 'lib')
const stageDshSource = join(repoRoot, 'build', 'stage', 'dsh')
const stageDistSource = join(repoRoot, 'build', 'stage', 'dist')
const { version } = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))

function fail(message) {
  process.stderr.write(`pack-mac: ${message}\n`)
  process.exit(1)
}

async function assertExists(path, label) {
  if (!existsSync(path)) fail(`${label} not found at ${path}; did you run \`pnpm run build\`?`)
}

async function main() {
  await assertExists(electronAppSource, 'Electron.app')
  await assertExists(libSource, 'lib/')
  await assertExists(stageDshSource, 'bundled CLI stage')
  await assertExists(stageDistSource, 'bundled frontend stage')

  const appBundle = join(distDir, 'DeepSeek Harness.app')
  if (existsSync(appBundle)) await rm(appBundle, { recursive: true, force: true })
  await mkdir(join(appBundle, 'Contents', 'Resources'), { recursive: true })

  process.stdout.write('pack-mac: copying Electron.app frame\n')
  await cp(electronAppSource, appBundle, {
    recursive: true,
    dereference: true,
  })

  process.stdout.write('pack-mac: staging app/ under Resources/\n')
  const appStaging = join(appBundle, 'Contents', 'Resources', 'app')
  await mkdir(appStaging, { recursive: true })
  await cp(libSource, join(appStaging, 'lib'), {
    recursive: true,
    dereference: true,
  })
  const pkg = {
    name: '@deepseek-ai/dsh-desktop',
    version,
    main: 'lib/main.cjs',
  }
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(appStaging, 'package.json'), JSON.stringify(pkg, null, 2))

  process.stdout.write('pack-mac: copying bundled CLI + frontend\n')
  await cp(stageDshSource, join(appBundle, 'Contents', 'Resources', 'dsh'), {
    recursive: true,
    dereference: true,
  })
  await cp(stageDistSource, join(appBundle, 'Contents', 'Resources', 'dist'), {
    recursive: true,
    dereference: true,
  })

  // Up-version Info.plist CFBundleVersion / CFBundleShortVersionString
  // (Electron's default is 99.0.0 / 0.0.0 — override to our package version).
  const infoPlistPath = join(appBundle, 'Contents', 'Info.plist')
  const plist = await import('node:fs/promises')
  let plistSrc
  try {
    plistSrc = (await plist.readFile(infoPlistPath, 'utf8'))
  } catch {
    // Plist as binary; skip in that case.
    plistSrc = ''
  }
  if (plistSrc.includes('<key>CFBundleVersion</key>')) {
    const newPlist = plistSrc
      .replace(
        /<key>CFBundleVersion<\/key>\s*<string>[^<]+<\/string>/,
        `<key>CFBundleVersion</key><string>${version}</string>`,
      )
      .replace(
        /<key>CFBundleShortVersionString<\/key>\s*<string>[^<]+<\/string>/,
        `<key>CFBundleShortVersionString</key><string>${version}</string>`,
      )
      .replace(
        /<key>CFBundleName<\/key>\s*<string>[^<]+<\/string>/,
        '<key>CFBundleName</key><string>DeepSeek Harness</string>',
      )
      .replace(
        /<key>CFBundleIdentifier<\/key>\s*<string>[^<]+<\/string>/,
        '<key>CFBundleIdentifier</key><string>io.github.tduarte.dsh-desktop</string>',
      )
      .replace(
        /<key>CFBundleExecutable<\/key>\s*<string>[^<]+<\/string>/,
        '<key>CFBundleExecutable</key><string>DeepSeek Harness</string>',
      )
    if (newPlist !== plistSrc) {
      await plist.writeFile(infoPlistPath, newPlist, 'utf8')
    }
    // Rename the executable to match CFBundleExecutable
    const oldExec = join(appBundle, 'Contents', 'MacOS', 'Electron')
    const newExec = join(appBundle, 'Contents', 'MacOS', 'DeepSeek Harness')
    try {
      await import('node:fs/promises').then(m => m.rename(oldExec, newExec))
    } catch { /* ignore */ }
  }

  // Electron binaries sometimes lose +x in tar+extract.
  const helperBin = join(appBundle, 'Contents', 'MacOS', 'Electron')
  try {
    await chmod(helperBin, 0o755)
  } catch { /* ignore */ }

  const s = await stat(appBundle)
  process.stdout.write(`pack-mac: ${s.size} bytes at ${appBundle}\n`)
  process.stdout.write('pack-mac: done\n')
}

await main()