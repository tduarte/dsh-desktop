/**
 * Preload script: minimal `contextBridge` surface for the renderer.
 *
 * Runs in an isolated world with access to a small set of Node APIs (`ipcRenderer`,
 * `process.platform`); the renderer process itself has no Node and no remote.
 *
 * The exposed surface is declared as `DshDesktopApi` in `src/types.ts`. Anything
 * not on that surface is not reachable from the renderer.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { DshDesktopApi, UpdateEvent } from './types.ts'
import { IPC } from './types.ts'

const api: DshDesktopApi = {
  openExternal(url) {
    return ipcRenderer.invoke(IPC.openExternal, url)
  },
  platform: process.platform,
  onUpdateProgress(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: UpdateEvent): void => {
      listener(payload)
    }
    ipcRenderer.on(IPC.updateProgress, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC.updateProgress, wrapped)
    }
  },
  checkForUpdates() {
    return ipcRenderer.invoke(IPC.checkForUpdates)
  },
  quitAndInstall() {
    return ipcRenderer.invoke(IPC.quitAndInstall)
  },
}

contextBridge.exposeInMainWorld('dshDesktop', api)