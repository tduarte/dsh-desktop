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
| Linux (Flatpak) | Flatpak → Bubblewrap → child `dsh` (via zypak) | Bubblewrap; Chromium setuid sandbox disabled | Electron2 BaseApp provides zypak, which places Chromium under the bwrap sandbox without the nested setuid sandbox |
| Linux (no Flatpak) | unsandboxed | none | Flatpak is the supported Linux path |

### Why zypak + `--no-sandbox`?

The Electron2 BaseApp (which the Flatpak manifest declares via `base` /
`base-version`) ships `zypak-helper`: a tiny helper that places Chromium
under Flatpak's Bubblewrap sandbox without Chromium's setuid sandbox — the
two compete for the same setuid bits. The wrapper at `flatpak/wrapper.sh`
invokes Electron via `zypak-wrapper.sh` and passes `--no-sandbox` to the
Electron binary. The trust fence is Bubblewrap (provided by the Flatpak
runtime) plus zypak; Chromium's own setuid sandbox is unused. Every
Electron app on Flathub does this.

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
flatpak update io.github.tduarte.dsh-desktop
```

## Bundle staging

`build/bundle-dsh.mjs` runs `npm install --omit=dev` in a fresh temp dir
with `@deepseek-ai/dsh` declared as a direct dep. npm hoists the full peer-dep
closure into a flat `node_modules/`. The script then:

- copies `node_modules/@deepseek-ai/dsh/{lib,config,package.json,node_modules}`
  into `build/stage/dsh/` with `fs.cp({recursive: true, dereference: true})`;
- copies `node_modules/@deepseek-ai/dsh-web-frontend/dist/` into
  `build/stage/dist/`.

`build/pack-linux.mjs` consumes the staged tree, plus the compiled Electron
app (`lib/main.cjs`, `lib/preload.cjs`) and the Electron binary, and emits
`dist/DeepSeek-Harness-<version>-linux-x64.tar.gz`. The flatpak manifest
references this tarball as a plain local `file` source — flatpak-builder
stages it at `/app/extra/dsh-desktop.tar.gz` and an `apply_extra` script
(declared inline in the manifest) extracts it on the user's machine at
install time.

## CI

`.github/workflows/desktop.yml` runs a 3-OS matrix on PR/push and on `v*` tags.
`build-linux` runs on `ubuntu-22.04`: it installs `flatpak-builder` via apt,
adds `flathub` as a user remote (so `--user` mode can resolve the
`org.electronjs.Electron2.BaseApp//24.08` base), then invokes
`pnpm run flatpak:build`. The default `--user` install lands the BaseApp
runtime in `~/.local/share/flatpak/`, which is exactly what a non-root
runner needs.

On tag pushes, the `release` job downloads all three artifacts and uses
`softprops/action-gh-release@v2` to attach them to the existing GitHub Release
matching the tag. Linux artifacts: `DeepSeek-Harness-<v>.flatpak` (single-file
install bundle) and `repo.tar.gz` (OSTree repo for `flatpak remote-add --from`).
macOS artifacts: `DSH Desktop.app/**` plus `latest-mac.yml`. Windows
artifact: `DeepSeek-Harness-<v>-win-x64.zip`.

Code signing and notarization are deferred to a follow-up PR. macOS
(`hardenedRuntime: false`, `gatekeeperAssess: false`), Windows
(no `certificateFile` / `certificatePassword`), Flatpak (no GPG key). The
release notes call this out.