# Desktop packaging notes

## Host-shell semantics

`dsh-desktop` is **not** a new runtime. It is an Electron host shell that:

1. Spawns the upstream `@deepseek-ai/dsh` webserver as a child process with
   `--no-open --port 0 --host 127.0.0.1`.
2. Waits for the URL line emitted by `@deepseek-ai/dsh-web-app` at
   `packages/bundle/web-app/src/index.ts:265` (this repo's contract is the
   regex in `src/types.ts#URL_DETECT_RE`).
3. Opens a hardened `BrowserWindow` (`nodeIntegration: false`, `contextIsolation: true`,
   `sandbox: true`) against that URL.
4. Forwards `app.before-quit` to the child via SIGTERM (5 s grace, then SIGKILL).

All filesystem and subprocess work happens inside the child `dsh` process
through upstream's Cordis plugin graph. The Electron main adds nothing new to
the trust surface — it only hosts a Chromium view of the same local URL the
CLI browser would have opened.

## Sandbox posture

| OS | Surface | Sandbox primitive | Notes |
|---|---|---|---|
| macOS | Terminal → Electron → child `dsh` | macOS Seatbelt (via `@deepseek-ai/dsh-shell`) | inherited from upstream unchanged |
| Windows | NSIS installer → Electron → child `dsh` | Windows Job Objects (via `dsh-subprocess`) | inherited from upstream unchanged |
| Linux (Flatpak) | Flatpak → Bubblewrap → child `dsh` | Bubblewrap; upstream Landlock profile skipped | wrapper sets `DSH_SANDBOX_DISABLED=1` |
| Linux (no Flatpak) | unsandboxed | none | Flatpak is the supported Linux path |

### Why `ELECTRON_DISABLE_SANDBOX=1`?

Chromium's setuid sandbox cannot double-nest with Flatpak's Bubblewrap — both
want to manipulate the same setuid bits. Every Electron app on Flathub does
this. The trust fence is Bubblewrap; Chromium's sandbox is the redundant
inner layer that cannot be used here. The wrapper at
`flatpak/wrapper.sh` sets the env var and passes `--no-sandbox` to electron.

## Update channel

`electron-updater` reads `app-update.yml` and polls this repo's GitHub
Releases (`tduarte/dsh-desktop`). The flow:

1. On launch and every 6 hours, the main process checks for a new release.
2. If found, the update downloads silently. Progress events broadcast to the
   renderer via `dsh:update-progress` IPC.
3. The renderer shows a non-disruptive banner; the user keeps working.
4. On `app.before-quit`, `quitAndInstall()` runs the install.

For Linux, Flatpak's `flatpak update` is the update path — `electron-updater`
is macOS/Windows only. The Linux release uploads `repo.tar.gz` (an OSTree repo)
alongside the `.flatpak`, so users can run:

```sh
flatpak remote-add --from \
  https://github.com/tduarte/dsh-desktop/releases/download/<tag>/repo.tar.gz \
  dsh-desktop
flatpak update ai.deepseek.harness.desktop
```

## Bundle staging

`build/bundle-dsh.mjs` runs `npm install --omit=dev` in a fresh temp dir
with `@deepseek-ai/dsh` declared as a direct dep. npm hoists the full peer-dep
closure into a flat `node_modules/`. The script then:

- copies `node_modules/@deepseek-ai/dsh/{lib,config,package.json,node_modules}`
  into `build/stage/dsh/` with `fs.cp({recursive: true, dereference: true})`;
- copies `node_modules/@deepseek-ai/dsh-web-frontend/dist/` into
  `build/stage/dist/`.

`electron-builder`'s `extraResources` then copies the staged tree to the
packaged app's `resources/dsh/` and `resources/dist/`. On Flatpak, the same
staged tree is consumed by `flatpak-builder`'s `stage` module, while the
prebuilt Electron app archive (built by `electron-builder --linux --x64`) is
pulled in as `extra-data` from the matching GitHub Release.

## CI

`.github/workflows/desktop.yml` runs a 3-OS matrix on PR/push and on `v*` tags.
On tag pushes, the `release` job downloads all artifacts and uses
`softprops/action-gh-release@v2` to attach them to the existing GitHub Release
matching the tag. `latest.yml`, `latest-mac.yml`, `latest-linux.yml` are
emitted by electron-builder alongside the binaries.

## Signing roadmap

Code signing and notarization are deferred to a follow-up PR. macOS
(`hardenedRuntime: false`, `gatekeeperAssess: false`), Windows
(no `certificateFile` / `certificatePassword`), Flatpak (no GPG key). The
release notes call this out.