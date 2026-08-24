/**
 * Wrapper around `electron-updater`.
 *
 * - Polls GitHub Releases on launch and every 6 hours via `setInterval`.
 * - Forwards lifecycle events to a callback (which the main process broadcasts
 *   to the renderer via IPC).
 * - Tracks a "downloaded" flag; `installIfDownloaded()` is awaited on quit so
 *   the harness session files can flush first.
 *
 * Failure modes are logged to stderr and surfaced as an `error` UpdateEvent;
 * the app keeps running on its current version.
 */

import process from 'node:process'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { UpdateEvent } from './types.ts'

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000

export class Updater {
  private listener: ((event: UpdateEvent) => void) | null = null
  private downloaded = false
  private nextQuitInstall = false

  async start(listener: (event: UpdateEvent) => void): Promise<void> {
    this.listener = listener
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('checking-for-update', () => this.emit({ state: 'checking' }))
    autoUpdater.on('update-available', (info: UpdateInfo) => this.emit({ state: 'available', version: info.version }))
    autoUpdater.on('update-not-available', () => this.emit({ state: 'not-available' }))
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.emit({ state: 'downloading', percent: progress.percent })
    })
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.downloaded = true
      this.emit({ state: 'downloaded', version: info.version })
    })
    autoUpdater.on('error', (error: Error) => {
      this.emit({ state: 'error', message: error.message })
    })

    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`updater: initial check failed: ${message}\n`)
    }
    setInterval(() => {
      void this.checkNow()
    }, POLL_INTERVAL_MS).unref()
  }

  async checkNow(): Promise<void> {
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ state: 'error', message })
    }
  }

  installOnNextQuit(): void {
    if (this.downloaded) {
      this.nextQuitInstall = true
    }
  }

  async installIfDownloaded(): Promise<void> {
    if (this.downloaded && this.nextQuitInstall) {
      autoUpdater.quitAndInstall()
    }
  }

  private emit(event: UpdateEvent): void {
    this.listener?.(event)
  }
}