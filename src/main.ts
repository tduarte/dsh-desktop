/**
 * Electron main process for DeepSeek Harness desktop.
 *
 * Lifecycle:
 *   1. Acquire single-instance lock; second launches focus the existing window.
 *   2. Spawn the bundled `dsh web` child from `process.resourcesPath/dsh/lib/bin.js`
 *      with `--no-open --port 0 --host 127.0.0.1` (loopback-only; the OS picks the
 *      port; the CLI's own browser handoff is suppressed so it does not race ours).
 *      The child is launched via Electron's own binary in node mode
 *      (`ELECTRON_RUN_AS_NODE=1` + `--expose-internals`) so we don't carry a
 *      separate Node install. `--expose-internals` is required by
 *      `@deepseek-ai/cordis-plugin-hmr`, which the harness's web profile loads
 *      unconditionally to support live-reloading user patches.
 *   3. Buffer child stdout; the moment a line matches `dsh web: http://127.0.0.1:<port>`,
 *      open a `BrowserWindow` against that URL with hardened webPreferences.
 *   4. On `app.before-quit`: SIGTERM the child, wait up to 5 s, then SIGKILL (or
 *      `taskkill /T` on Windows).
 *   5. On a non-zero child exit before the window is up: surface the stderr tail
 *      and quit.
 *
 * Auto-update: `electron-updater` polls GitHub Releases; progress is forwarded
 * to the renderer via the `dsh:update-progress` IPC channel. Installation runs
 * on next `app.before-quit` via `quitAndInstall()`.
 *
 * Sandbox posture: this main does not grant `nodeIntegration`. All FS /
 * subprocess work lives inside the child `dsh` process via upstream Cordis
 * plugins. Under Flatpak, Bubblewrap replaces Landlock (wrapper sets
 * `ELECTRON_DISABLE_SANDBOX=1`); see `flatpak/wrapper.sh`.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { IPC, detectUrl, type UpdateEvent } from './types.ts'
import { Updater } from './updater.ts'

const CHILD_GRACE_MS = 5_000
const STDERR_TAIL_BYTES = 4_096
const DEBUG = process.env.DSH_DESKTOP_DEBUG === '1'

function debug(...args: unknown[]): void {
  if (DEBUG) {
    process.stderr.write(`[dsh-desktop] ${args.map(String).join(' ')}\n`)
  }
}

class UrlDetector {
  private buffer = ''
  private resolved: string | null = null

  feed(chunk: string): string | null {
    if (this.resolved !== null) return null
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      const detected = detectUrl(line)
      if (detected !== null) {
        this.resolved = detected.url
        return detected.url
      }
      newline = this.buffer.indexOf('\n')
    }
    return null
  }
}

class ChildSupervisor {
  readonly proc: ChildProcess
  private stderrTail = ''
  private urlDetector = new UrlDetector()

  constructor(nodeBin: string, dshBin: string) {
    // Pass `--expose-internals` so `@deepseek-ai/cordis-plugin-hmr` can attach;
    // it unconditionally loads in the upstream web profile and crashes without
    // the flag. This is a benign capability grant — the same Node flag is
    // used by VS Code, Discord, and every Cordis-based live-reload app.
    //
    // `ELECTRON_RUN_AS_NODE=1` makes the Electron binary run as plain Node.
    // Electron 43+ requires the env var explicitly; the `--expose-internals`
    // flag alone no longer flips into Node mode.
    this.proc = spawn(
      nodeBin,
      ['--expose-internals', dshBin, 'web', '--no-open', '--port', '0', '--host', '127.0.0.1'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
    )
    debug(`child spawned: pid=${String(this.proc.pid)}, bin=${nodeBin}`)
    this.proc.stdout?.setEncoding('utf8')
    this.proc.stderr?.setEncoding('utf8')
  }

  onStdout(listener: (chunk: string) => void): void {
    this.proc.stdout?.on('data', (chunk: string) => {
      debug(`child stdout: ${chunk.trimEnd()}`)
      listener(chunk)
    })
  }

  onStderr(listener: (chunk: string) => void): void {
    this.proc.stderr?.on('data', (chunk: string) => {
      debug(`child stderr: ${chunk.trimEnd()}`)
      listener(chunk)
    })
  }

  /**
   * Feed stdout into the URL detector; returns the first captured URL, or null.
   */
  detectUrl(chunk: string): string | null {
    return this.urlDetector.feed(chunk)
  }

  /**
   * Track the last `STDERR_TAIL_BYTES` of stderr for diagnostic surfacing.
   */
  appendStderr(chunk: string): void {
    this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_BYTES)
  }

  /**
   * SIGTERM, wait up to `graceMs`, then SIGKILL (or `taskkill /T` on Windows).
   */
  terminate(graceMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.proc.exitCode !== null) {
        resolve()
        return
      }
      const timer = setTimeout(() => {
        if (this.proc.exitCode !== null) {
          resolve()
          return
        }
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(this.proc.pid ?? 0), '/T', '/F'])
        } else {
          this.proc.kill('SIGKILL')
        }
        resolve()
      }, graceMs)
      this.proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(this.proc.pid ?? 0), '/T'])
      } else {
        this.proc.kill('SIGTERM')
      }
    })
  }

  get lastStderr(): string {
    return this.stderrTail
  }
}

class HarnessDesktopApp {
  private supervisor: ChildSupervisor | null = null
  private window: BrowserWindow | null = null
  private shuttingDown = false
  private readonly updater = new Updater()

  start(): void {
    debug('start()')
    const lock = app.requestSingleInstanceLock()
    if (!lock) {
      debug('single-instance lock failed; another instance is running')
      app.quit()
      return
    }
    app.on('second-instance', () => {
      this.window?.show()
      this.window?.focus()
    })

    void app.whenReady().then(async () => {
      debug('whenReady fired')
      this.registerIpc()
      debug('ipc registered')
      await this.updater.start((event) => this.broadcastUpdate(event))
      debug('updater started')
      await this.bootChild()
      debug('bootChild done')
    })

    app.on('before-quit', async (event) => {
      if (this.shuttingDown) return
      this.shuttingDown = true
      event.preventDefault()
      await this.updater.installIfDownloaded()
      await this.supervisor?.terminate(CHILD_GRACE_MS)
      app.exit(0)
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit()
    })
  }

  private registerIpc(): void {
    ipcMain.handle(IPC.openExternal, async (_event, url: string) => {
      if (typeof url === 'string' && /^https?:\/\//.test(url)) {
        await shell.openExternal(url)
      }
    })
    ipcMain.handle(IPC.checkForUpdates, async () => {
      await this.updater.checkNow()
    })
    ipcMain.handle(IPC.quitAndInstall, async () => {
      this.updater.installOnNextQuit()
      app.quit()
    })
  }

  private broadcastUpdate(event: UpdateEvent): void {
    this.window?.webContents.send(IPC.updateProgress, event)
  }

  private async bootChild(): Promise<void> {
    const dshBin = resolveDshBin()
    debug(`dshBin=${dshBin}`)
    if (!existsSync(dshBin)) {
      void dialog.showErrorBox(
        'DeepSeek Harness desktop',
        `dsh binary not found at ${dshBin}. The install may be corrupted; please reinstall.`,
      )
      app.quit()
      return
    }
    const supervisor = new ChildSupervisor(process.execPath, dshBin)
    this.supervisor = supervisor
    supervisor.onStdout((chunk) => {
      const url = supervisor.detectUrl(chunk)
      debug(`detectUrl -> ${String(url)}`)
      if (url !== null && this.window === null) {
        debug(`opening BrowserWindow at ${url}`)
        this.window = new BrowserWindow({
          width: 1280,
          height: 800,
          show: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: join(__dirname, 'preload.cjs'),
          },
        })
        this.window.on('close', () => app.quit())
        void this.window.loadURL(url)
      }
    })
    supervisor.onStderr((chunk) => {
      supervisor.appendStderr(chunk)
      process.stderr.write(chunk)
    })
    supervisor.proc.on('exit', (code) => {
      debug(`child exit code=${String(code)}`)
      if (code !== 0 && code !== null && this.window === null && !this.shuttingDown) {
        void dialog.showErrorBox(
          'DeepSeek Harness failed to start',
          `The dsh webserver exited with code ${String(code)} before the UI was ready.\n\nLast stderr:\n${supervisor.lastStderr}`,
        )
        app.quit()
      }
    })
  }
}

function resolveDshBin(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'dsh', 'lib', 'bin.js')
  }
  return join(__dirname, '..', 'build', 'stage', 'dsh', 'lib', 'bin.js')
}

debug(`main.cjs loaded: __dirname=${__dirname}`)
new HarnessDesktopApp().start()