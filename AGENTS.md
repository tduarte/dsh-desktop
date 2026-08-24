# AGENTS.md — dsh-desktop

DeepSeek Harness desktop app. Electron host shell that boots the upstream `@deepseek-ai/dsh` webserver in a child process and renders it in a `BrowserWindow`.

## Pre-release stance

This repo is the desktop surface of `deepseek-harness`, but lives in its own repo (`tduarte/dsh-desktop`) with its own release flow. The two evolve independently. **No upstream edits allowed.** If a change requires modifying upstream `deepseek-harness`, file an issue there; this repo cannot PR upstream on its own.

## Repository layout

```
src/                    Electron main + preload + shared types
build/                  Staging scripts (bundle-dsh.mjs, flatpak-build.sh) + icon assets
flatpak/                Linux Flatpak manifest + desktop entry + wrapper + metainfo
tests/                  vitest specs
.github/workflows/      CI: build matrix, GitHub Release, flatpak export
```

## Commands

```sh
pnpm install                          # resolves @deepseek-ai/dsh + @deepseek-ai/dsh-web-frontend
pnpm run build                        # stage + bundle src → lib/
pnpm run start                        # run Electron against staged dsh/
pnpm run dist:mac                     # .dmg (macOS only)
pnpm run dist:win                     # .exe (Windows only)
pnpm run dist:linux                   # .tar.gz (Linux, fed to flatpak-builder)
pnpm run flatpak:build                # .flatpak + OSTree repo (Linux only)
pnpm run typecheck
pnpm run test
```

## Conventions

- **ESM in `src/`, CommonJS output.** tsdown emits CJS because Electron's main + preload must be CJS. Source can still be ESM (TS imports), just transpiled.
- **No `nodeIntegration`.** Renderer is sandboxed; all FS / subprocess work flows through the child `dsh` process via the harness's plugin system.
- **Single-instance lock.** Second `open DeepSeek Harness.app` focuses the existing window — does not spawn a second webserver.
- **URL detection.** Boot waits for `dsh web: http://127.0.0.1:<port>` on child stdout (matches `/dsh web: https?:\/\/127\.0\.0\.1:\d+/`). This is the only integration point with upstream — see `src/main.ts#detectUrl`.
- **Child flags:** `--no-open --port 0 --host 127.0.0.1`. `--no-open` mandatory so the CLI's browser handoff does not race the Electron window.
- **Auto-update:** `electron-updater` against GitHub Releases of this repo (`tduarte/dsh-desktop`). Silent download on launch; renderer banner via IPC; install on next `app.before-quit`. On Linux the renderer banner surfaces the `.flatpak` download URL; in-place install needs `flatpak update` against the OSTree repo (`build/flatpak-build.sh` exports one).
- **Versions:** `package.json#version` is the source of truth. Tag this repo with `v<version>`. CI publishes to that GitHub Release. No coupling to upstream's `dsh-v*` tag namespace.

## Sandbox posture

- **macOS / Windows:** unchanged. Child `dsh` process keeps Landlock / Seatbelt / Job Objects.
- **Linux under Flatpak:** Bubblewrap replaces Landlock. Wrapper sets `ELECTRON_DISABLE_SANDBOX=1` (Chromium's setuid sandbox cannot double-nest with Bubblewrap; every Electron app on Flathub does this).

## Editing this file

Keep rules self-contained; link docs for high-level context.