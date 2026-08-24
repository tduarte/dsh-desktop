# dsh-desktop

DeepSeek Harness desktop app. Electron host shell that boots the upstream `@deepseek-ai/dsh` webserver and renders it in a native window.

- **macOS** — `.dmg` (unsigned in this PR)
- **Windows** — `.exe` NSIS installer (unsigned in this PR)
- **Linux** — `.flatpak` (Flathub-ready; Flathub submission is a follow-up)

Auto-updates from GitHub Releases.

## Install

### macOS

Download the latest `.dmg` from [Releases](https://github.com/tduarte/dsh-desktop/releases), open it, drag **DeepSeek Harness** to Applications. First launch shows Gatekeeper's "unidentified developer" warning — right-click → Open, then confirm. Code signing is a follow-up PR.

### Windows

Download the latest `.exe` from Releases, run it. SmartScreen may warn on first launch; click "More info" → "Run anyway". Code signing is a follow-up PR.

### Linux (Flatpak)

```sh
# one-time: get the runtime
flatpak install --user flathub org.electronjs.Electron2.BaseApp//24.08

# install the app from a downloaded .flatpak
flatpak install --user --bundle <path-to>/DeepSeek-Harness-<version>.flatpak

# run it
flatpak run ai.deepseek.harness.desktop
```

Update:

```sh
flatpak update ai.deepseek.harness.desktop
```

## Development

Requires Node ≥ 22 and pnpm ≥ 10.

```sh
pnpm install
pnpm run build      # stages dsh + web dist, then bundles src → lib/
pnpm run start      # launches Electron against the staged artifacts
```

Local dev reads the staged artifacts under `build/stage/` (populated by `build/bundle-dsh.mjs`). The script runs `npm install --omit=dev` in a fresh temp dir with `@deepseek-ai/dsh` declared as a direct dep; npm resolves the full peer-dep closure into a flat `node_modules/`, which the script then copies (with dereference) into `build/stage/dsh/`. The web frontend (`@deepseek-ai/dsh-web-frontend/dist`) is copied into `build/stage/dist/`.

## Packaging

Per-OS commands in `package.json#scripts`:

| OS | Command | Output |
|---|---|---|
| macOS | `pnpm run dist:mac` | `dist/DeepSeek-Harness-<version>.dmg` |
| Windows | `pnpm run dist:win` | `dist/DeepSeek-Harness-Setup-<version>.exe` |
| Linux (Electron archive) | `pnpm run dist:linux` | `dist/DeepSeek-Harness-<version>-linux-x64.tar.gz` |
| Linux (Flatpak) | `pnpm run flatpak:build` | `build/flatpak-out/DeepSeek-Harness-<version>.flatpak` + OSTree repo at `build/flatpak-out/repo/` |

CI runs all three on `v<version>` tags and uploads the artifacts to GitHub Releases via `softprops/action-gh-release@v2`. See `.github/workflows/desktop.yml`.

## Architecture

`dsh-desktop` is a host shell. It does not implement agent behavior — that lives in `@deepseek-ai/dsh`. The Electron main process:

1. Spawns `node build/stage/dsh/lib/bin.js web --no-open --port 0 --host 127.0.0.1` as a child.
2. Buffers child stdout; matches the URL line emitted by `@deepseek-ai/dsh-web-app` at `packages/bundle/web-app/src/index.ts:265` (`dsh web: http://127.0.0.1:<port>`).
3. On first match, opens a `BrowserWindow` against that URL with `nodeIntegration: false, contextIsolation: true, sandbox: true`.
4. Forwards `app.before-quit` as SIGTERM to the child (5-second grace, then SIGKILL on POSIX / `taskkill /T` on Windows).
5. Periodically asks `electron-updater` for new versions, forwards progress to the renderer, installs on quit.

All filesystem / subprocess work inside the webserver session flows through the harness's Cordis plugin graph in the child `dsh` process — same trust surface as `dsh --profile web` invoked from a terminal.

See `docs/desktop.md` for the sandbox posture and security notes.