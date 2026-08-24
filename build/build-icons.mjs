#!/usr/bin/env node
/**
 * Render the icon from `dsh-desktop.icon/Assets/deepseek.svg` to all platform
 * formats:
 *   build/icon-{16,32,48,64,128,256,512}.png  Flatpak hicolor set
 *   build/icon.png                             master 1024x1024 PNG
 *   build/icon-source.png                      same as icon.png (electron-builder source)
 *   build/icon.icns                            macOS .icns via iconutil
 *   build/icon.ico                             Windows ICO (multi-size)
 *
 * Source-of-truth layout:
 *   dsh-desktop.icon/                         Apple Icon Composer file (directory)
 *   dsh-desktop.icon/Assets/deepseek.svg      vector source
 *   dsh-desktop.icon/icon.json                layout metadata
 *
 * The Apple Icon Composer file holds more than the flat SVG — it also encodes
 * per-platform features (refractivity, translucency, dark-mode layers). To
 * bake those, open the `.icon` file in Xcode's Icon Composer app and export
 * a fresh `.iconset/` to overwrite this script's output. For now we render
 * the SVG straight to PNG/ICO/ICNS, which matches the flat-icon behavior
 * used by every Electron app on Flathub / Sparkle.
 *
 * Requirements:
 *   - `sharp` (devDependency)
 *   - macOS `iconutil` (built into macOS) for the .icns conversion
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
import process from 'node:process'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..')
const svgPath = join(repoRoot, 'dsh-desktop.icon', 'Assets', 'deepseek.svg')
const buildDir = join(repoRoot, 'build')

const SIZES = [16, 32, 48, 64, 128, 256, 512]
const ICO_SIZES = [16, 32, 48, 64, 128, 256]

function fail(message) {
  process.stderr.write(`build-icons: ${message}\n`)
  process.exit(1)
}

async function renderPngs(svgBuf) {
  await mkdir(buildDir, { recursive: true })
  for (const size of SIZES) {
    await sharp(svgBuf, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(join(buildDir, `icon-${size}.png`))
  }
  await sharp(svgBuf, { density: 384 })
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(join(buildDir, 'icon.png'))
  await sharp(svgBuf, { density: 384 })
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(join(buildDir, 'icon-source.png'))
}

async function renderIco(svgBuf) {
  const pngs = await Promise.all(
    ICO_SIZES.map(async (size) => ({
      size,
      buf: await sharp(svgBuf, { density: 384 })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
    })),
  )
  const dirSize = 6 + 16 * pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = Buffer.alloc(16 * pngs.length)
  let offset = dirSize
  for (let i = 0; i < pngs.length; i += 1) {
    const { size, buf } = pngs[i]
    const off = i * 16
    entries.writeUInt8(size === 256 ? 0 : size, off + 0)
    entries.writeUInt8(size === 256 ? 0 : size, off + 1)
    entries.writeUInt8(0, off + 2)
    entries.writeUInt8(0, off + 3)
    entries.writeUInt16LE(1, off + 4)
    entries.writeUInt16LE(32, off + 6)
    entries.writeUInt32LE(buf.length, off + 8)
    entries.writeUInt32LE(offset, off + 12)
    offset += buf.length
  }
  const out = Buffer.concat([header, entries, ...pngs.map((p) => p.buf)])
  await writeFile(join(buildDir, 'icon.ico'), out)
}

async function renderIcns() {
  if (process.platform !== 'darwin') {
    process.stdout.write('build-icons: skipping icon.icns (requires macOS iconutil)\n')
    return
  }
  const iconsetDir = join(buildDir, 'app.iconset')
  await mkdir(iconsetDir, { recursive: true })

  const copy = (src, dest) => {
    writeFileSync(dest, readFileSync(src))
  }

  // iconutil wants canonical filenames: icon_<size>x<size>.png and @2x variants.
  copy(join(buildDir, 'icon-16.png'),  join(iconsetDir, 'icon_16x16.png'))
  copy(join(buildDir, 'icon-32.png'),  join(iconsetDir, 'icon_16x16@2x.png'))
  copy(join(buildDir, 'icon-32.png'),  join(iconsetDir, 'icon_32x32.png'))
  copy(join(buildDir, 'icon-64.png'),  join(iconsetDir, 'icon_32x32@2x.png'))
  copy(join(buildDir, 'icon-128.png'), join(iconsetDir, 'icon_128x128.png'))
  copy(join(buildDir, 'icon-256.png'), join(iconsetDir, 'icon_128x128@2x.png'))
  copy(join(buildDir, 'icon-256.png'), join(iconsetDir, 'icon_256x256.png'))
  copy(join(buildDir, 'icon-512.png'), join(iconsetDir, 'icon_256x256@2x.png'))
  copy(join(buildDir, 'icon-512.png'), join(iconsetDir, 'icon_512x512.png'))
  copy(join(buildDir, 'icon.png'),     join(iconsetDir, 'icon_512x512@2x.png'))

  execFileSync('iconutil', ['-c', 'icns', iconsetDir], { stdio: 'inherit' })
  // iconutil writes <dir>.icns beside the source dir.
  const written = join(buildDir, 'app.icns')
  if (!existsSync(written)) fail(`iconutil did not produce ${written}`)
  // Move to the canonical name and clean up.
  execFileSync('mv', [written, join(buildDir, 'icon.icns')])
  await rm(iconsetDir, { recursive: true, force: true })
}

async function main() {
  if (!existsSync(svgPath)) fail(`SVG source not found: ${svgPath}`)
  const svgBuf = await readFile(svgPath)

  process.stdout.write('build-icons: rendering PNGs\n')
  await renderPngs(svgBuf)

  process.stdout.write('build-icons: rendering .ico\n')
  await renderIco(svgBuf)

  process.stdout.write('build-icons: rendering .icns\n')
  await renderIcns()

  process.stdout.write('build-icons: done\n')
}

await main()