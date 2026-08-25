# Repository Guidelines

DeepSeek Harness desktop app. Electron host shell that boots the upstream `@deepseek-ai/dsh` webserver in a child process and renders it in a `BrowserWindow`. Pinned to Node `>=22`, pnpm `10.18`. ESM source, CJS output.

## Project Overview

- **Purpose:** Repackage the upstream `dsh` (DeepSeek Harness) Node webserver as a desktop application for macOS, Windows, and Linux (Flatpak). The Electron host is a thin shell: it spawns `dsh web` as a subprocess, captures the loopback URL from its stdout, and loads that URL into a sandboxed `BrowserWindow`.
- **Pre-release stance (non-negotiable):** this repo is the **desktop surface of `deepseek-harness`, but lives in its own repo** with its own release flow. The two evolve independently. **No upstream edits allowed.** If a change requires modifying upstream `deepseek-harness`, file an issue there; this repo cannot PR upstream on its own.
- **Versioning:** `package.json#version` is the source of truth. Tag this repo with `v<version>`. CI publishes to that GitHub Release. **No coupling to upstream's `dsh-v*` tag namespace** — bump `package.json#version` and `@deepseek-ai/dsh` independently.

## Architecture & Data Flow

```
┌──────────── Electron host (lib/main.cjs) ────────────┐
│  src/main.ts                                          │
│  ┌─ HarnessDesktopApp                                 │
│  │  ├ single-instance lock (app.requestSingleInstance)│
│  │  ├ app.whenReady → register IPC + start Updater   │
│  │  └ spawn child dsh webserver (process.execPath,    │
│  │     ELECTRON_RUN_AS_NODE=1, --expose-internals)    │
│  │                                                    │
│  ├─ ChildSupervisor                                   │
│  │  ├ args: --no-open --port 0 --host 127.0.0.1      │
│  │  ├ UrlDetector: line-buffered regex on stdout     │
│  │  │  matches /dsh web: https?:\/\/127\.0\.0\.1:\d+/│
│  │  ├ on match → new BrowserWindow(sandbox, 1280x800)│
│  │  └ on before-quit: SIGTERM child (5s grace,       │
│  │                   SIGKILL / taskkill /T /F)       │
│  │                                                    │
│  └─ ipcMain.handle × 3 + webContents.send × 1         │
│       (channels named in src/types.ts)                │
└────────────────────────┬───────────────────────────────┘
                         │ contextBridge
┌────────────────────────▼───────────────────────────────┐
│  src/preload.ts  (lib/preload.cjs, sandbox-safe)       │
│   contextBridge.exposeInMainWorld('dshDesktop', api)   │
└────────────────────────┬───────────────────────────────┘
                         │ window.dshDesktop
┌────────────────────────▼───────────────────────────────┐
│  Renderer (sandboxed: no nodeIntegration,              │
│   contextIsolation, sandbox)                          │
│   Loads URL captured by UrlDetector (the dsh web UI)  │
└────────────────────────────────────────────────────────┘
```

**Key contracts:**
- **URL detection** (`src/types.ts#URL_DETECT_RE` + `src/types.ts#detectUrl`): the only integration point with upstream. Boot waits for `dsh web: http://127.0.0.1:<port>` on child stdout. Tested in `tests/url-detect.spec.ts` + `tests/lifecycle.spec.ts`.
- **IPC channels** (names centralized in `src/types.ts`):
  - `dsh:open-external` (renderer → main, handle)
  - `dsh:check-for-updates` (renderer → main, handle)
  - `dsh:quit-and-install` (renderer → main, handle)
  - `dsh:update-progress` (main → renderer, `webContents.send` with `UpdateEvent` discriminated union)
- **Update flow** (`src/updater.ts`): wraps `electron-updater`, polls every 6h via `setInterval().unref()`, silently downloads, only installs when the renderer signals `quitAndInstall`. Update events surface to the renderer as `UpdateEvent` (discriminated union — `available` / `not-available` / `downloaded` / `progress` / `error`).
- **Termination:** on `app.before-quit` (idempotent via `shuttingDown` flag): install update if renderer opted in, then SIGTERM the child with a 5s grace and SIGKILL on expiry. On a non-zero child exit before the window opens, the last 4 KiB of stderr is surfaced in a dialog and the app quits.

## Key Directories

| Path | Purpose |
|---|---|
| `src/` | Electron main (`main.ts`), preload (`preload.ts`), updater wrapper (`updater.ts`), shared types + URL regex (`types.ts`). |
| `build/` | Staging + packaging scripts: `bundle-dsh.mjs` (stages upstream CLI/frontend), `build-icons.mjs` (renders `.icns`/`.ico`/multi-size `.png`), `pack-{mac,win,linux}.mjs` (manual pack, bypasses electron-builder's OOMing `nodeModulesCollector`), `flatpak-build.sh`. |
| `flatpak/` | Linux Flatpak manifest (`io.github.tduarte.dsh-desktop.yml`), desktop entry, AppStream metainfo, `wrapper.sh` (invokes Electron via `zypak-wrapper.sh` from the Electron2 BaseApp; passes `--no-sandbox`).
| `tests/` | Vitest specs. Only the URL-detection pure functions are unit-tested; everything else is integration coverage via CI. |
| `.github/workflows/` | `desktop.yml` — `typecheck-test`, `build-mac`, `build-win`, `build-linux`, `release`.
| `lib/` | tsdown CJS output (`main.cjs`, `preload.cjs`). Gitignored. |
| `dist/` | Pack script output (`.app`, win-x64 directory, linux tarball). Gitignored. |
| `build/stage/` | Staged upstream `dsh` CLI + frontend. Gitignored. |
| `docs/` | High-level design notes (`desktop.md`). Link, don't duplicate. |

## Development Commands

```sh
pnpm install                           # resolves @deepseek-ai/dsh + @deepseek-ai/dsh-web-frontend
pnpm run build                         # node build/bundle-dsh.mjs && tsdown
pnpm run start                         # electron .   (against the staged dsh/)
pnpm run typecheck                     # tsc --noEmit
pnpm run test                          # vitest run

# Per-OS packaging (manual pack, not electron-builder):
pnpm run icon:build                    # render all packaging icon assets
pnpm run dist:mac                      # produces dist/DeepSeek Harness.app (NO .dmg in v0.1.1)
pnpm run dist:win                      # produces dist/DeepSeek-Harness-<v>-win-x64/ directory
pnpm run dist:linux                    # produces .tar.gz consumed by flatpak-build.sh
pnpm run flatpak:build                 # Linux only: .flatpak + repo.tar.gz

# Inspect on CI / GitHub (use gh, not raw git+web):
gh workflow run desktop.yml --ref v0.1.1     # manual dispatch
gh run list --workflow=desktop.yml --limit 5
gh run watch <run-id>                         # block until a run settles
gh release list --limit 5
```

**CI gotcha:** every platform build job runs `node node_modules/electron/install.js` first. Electron's `package.json` exposes no install script, so pnpm 10 won't auto-invoke it — without this step `node_modules/electron/dist/` is empty and `electron .` fails.

## Code Conventions & Common Patterns

- **ESM in `src/`, CJS output.** tsdown emits CJS because Electron's main + preload must be CJS. Two per-entry configs in `tsdown.config.js`:
  - `main`: `noExternal` regex inlines everything except `electron` (electron-updater, builder-util, dmg-builder, js-yaml, semver, lodash.* all bundled inline).
  - `preload`: `noExternal: true` forces a single file with no relative `require()` to sibling chunks (sandboxed preloads cannot resolve chunk paths).
- **Strict TypeScript** (`tsconfig.base.json`): `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`. `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`. `types: [node, electron]`.
- **Single quotes, semicolons, `.ts` extensions on relative imports** (resolved by tsdown).
- **Async pattern:** `async/await` with `void`-prefixed fire-and-forget. **No top-level await**, **no `process.exit`** — use `app.quit()` / `app.exit(0)`.
- **Logging:** no third-party logger. An env-gated `debug()` helper in `src/main.ts` writes to stderr. `console.log` is fine for diagnostics; do not introduce `winston`/`pino` for this codebase.
- **IPC channel names live in `src/types.ts`** as a const map — never inline string literals in `ipcMain`/`webContents.send`/`contextBridge`. Adding a channel means editing `types.ts` first.
- **Shared types in `src/types.ts`:** `DshDesktopApi` interface (the `window.dshDesktop` shape), `UpdateEvent` discriminated union, `URL_DETECT_RE` regex, `detectUrl()` pure function.
- **Error handling on child exit:** last 4 KiB of stderr surfaced in a dialog before quit — preserve this on any new spawn path.
- **Single-instance lock is mandatory** — second `open DeepSeek Harness.app` focuses the existing window. Never bypass `app.requestSingleInstance` for fast path development.
- **`.npmrc` declares `node-linker=hoisted` + `shamefully-hoist=true` + `public-hoist-pattern[]=*`** — full hoist treatment required for Electron / electron-builder / native modules under pnpm 10. Do not change.

## Important Files

- `src/main.ts` — `HarnessDesktopApp` class, single-instance lock, `ChildSupervisor`, `UrlDetector` (line-buffered regex on stdout), `BrowserWindow` creation, `app.before-quit` shutdown.
- `src/preload.ts` — `DshDesktopApi` construction, `contextBridge.exposeInMainWorld('dshDesktop', api)`, update-progress subscription with disposer.
- `src/updater.ts` — `Updater` class wrapping `electron-updater`, 6h polling, gated install.
- `src/types.ts` — `URL_DETECT_RE`, `detectUrl()`, `DshDesktopApi`, `UpdateEvent`, IPC channel const map. **Edit this first when adding IPC.**
- `tsdown.config.js` — per-entry CJS bundling. Touching this requires understanding the preload sandboxing constraint.
- `electron-builder.yml` — `appId: io.github.tduarte.dsh-desktop`, mac dmg x64+arm64, win nsis, **no Linux section by design** (the flatpak is built from the linux tarball directly).
- `app-update.yml` — electron-updater feed: `provider: github, owner: tduarte, repo: dsh-desktop, releaseType: release`. For v0.1.1 pre-release, manifests are absent by design (see "Release" below).
- `build/bundle-dsh.mjs` — stages upstream `@deepseek-ai/dsh` (with flat `node_modules/` closure) and `@deepseek-ai/dsh-web-frontend` Vite dist into `build/stage/{dsh,dist}/`. Reuses pnpm-hoisted tree.
- `build/pack-{mac,win,linux}.mjs` — manual pack. Each produces only the directory layout (`pack-mac.mjs` patches `Info.plist` CFBundle* keys to `package.json#version`); no installer in v0.1.1.
- `flatpak/io.github.tduarte.dsh-desktop.yml` — `runtime: org.freedesktop.Platform`, `base: org.electronjs.Electron2.BaseApp`, `base-version: '24.08'`. Single `simple` buildsystem module installs icons, desktop, metainfo, the staged Linux tarball at `/app/extra/dsh-desktop.tar.gz`, an `apply_extra` script (extracts the tarball to `/app/dsh-desktop` at install time), and the launch wrapper at `/app/bin/dsh-desktop`.
- `flatpak/wrapper.sh` — invokes `zypak-wrapper.sh <electron> --no-sandbox /app/dsh-desktop/electron-app`. zypak-helper is inherited from the BaseApp at `/app/bin`.
- `flatpak/io.github.tduarte.dsh-desktop.metainfo.xml` — `<releases>` must be bumped on every release (currently `0.1.1`).
- `.github/workflows/desktop.yml` — jobs: `typecheck-test` (ubuntu), `build-mac` (macos-latest), `build-win` (windows-latest), `build-linux` (ubuntu-22.04; installs flatpak-builder via apt, adds `flathub` user remote, runs `pnpm run flatpak:build`, uploads `.flatpak` + `repo.tar.gz`), `release` (ubuntu, gated on tag push OR `workflow_dispatch`, downloads all three artifacts and publishes via `softprops/action-gh-release@v2`).

## Runtime/Tooling Preferences

- **Required runtime:** Node `>=22.0.0` (enforced in `package.json#engines`). CI uses `actions/setup-node@v6` with `NODE_VERSION: '22'`.
- **Package manager:** **pnpm 10.18** (pinned via `packageManager`). Use `pnpm install --frozen-lockfile` in CI; locally, do not commit lockfile churn from `--no-frozen-lockfile`.
- **GitHub operations:** use `gh` (CLI) — `gh workflow run`, `gh run list`, `gh run watch`, `gh release list`. Prefer it over `git push` + `gh api` for one-off operations.
- **Electron `install.js` quirk:** pnpm 10 does not auto-run Electron's install script. CI explicitly invokes `node node_modules/electron/install.js` after `pnpm install` to populate `node_modules/electron/dist/`.
- **No code signing / notarization** in this repo. macOS users right-click → Open; Windows users see a SmartScreen warning. Both deferred to a follow-up PR.
- **Sandbox posture:**
  - macOS / Windows: standard Chromium sandbox.

## Release

- **Tag format:** `v<package.json#version>`.
- **Trigger:** `push: tags: ['v*']` on `main` OR `workflow_dispatch` (manual via `gh workflow run desktop.yml --ref v0.1.1`).
- **Release job** downloads mac/win artifacts, zips the Windows directory, and publishes via `softprops/action-gh-release@v2` with `prerelease: true` and `generate_release_notes: true`.
- **v0.1.1 (current cut) is a manual-install pre-release:**
  - macOS: `DeepSeek Harness.app` (no `.dmg`, no `latest-mac.yml`).
  - Windows: `DeepSeek-Harness-0.1.1-win-x64.zip`.
  - Linux: `DeepSeek-Harness-0.1.1.flatpak` + `repo.tar.gz`.
- **Linux:** `build-linux` job runs flatpak-builder against the staged Linux tarball. The release uploads `DeepSeek-Harness-<v>.flatpak` (single-file bundle) and `repo.tar.gz` (OSTree repo, so users can `flatpak remote-add --from ...` then `flatpak update`).

## Testing & QA

- **Framework:** Vitest `^2.1.8`. Config: `vitest.config.ts` (node environment, `tests/**/*.spec.ts`).
- **Coverage:** **none.** No `@vitest/coverage`, no `c8`/`nyc`/`istanbul`. Do not invent thresholds in this PR — file an issue if coverage becomes a requirement.
- **What is tested:** the URL-detection pure functions only — `src/types.ts#URL_DETECT_RE` + `detectUrl()` (`tests/url-detect.spec.ts`) and the chunked-buffer state machine that wraps it (`tests/lifecycle.spec.ts`).
- **What is NOT tested at the unit level:** Electron app, `child_process` spawn, `BrowserWindow`, IPC, `Updater`. Coverage is via CI matrix builds.
- **Running:** `pnpm test` (CI: `pnpm run typecheck` then `pnpm run test` on `ubuntu-22.04`).
- **Conventions for new tests:** pure functions only. Mocking Electron / `child_process` is not currently done in this codebase — extend the `UrlDetector` buffer pattern if you need integration-level coverage, or add an Electron-driven test harness. Avoid `sleep` / real timers / real network.
- **CI signal:** every PR runs `typecheck-test` + `build-mac` + `build-win` in parallel. A green CI means the code typechecks, tests pass, and the macOS `.app` and Windows directory layout build successfully.

## Sandbox posture

- **macOS / Windows:** unchanged. Child `dsh` process keeps Landlock / Seatbelt / Job Objects.
- **Linux under Flatpak:** Bubblewrap replaces Landlock. The wrapper launches Electron via `zypak-wrapper.sh` from the Electron2 BaseApp; Chromium's setuid sandbox is unused (it would compete with Bubblewrap for the same setuid bits; every Electron app on Flathub does this).

## When in doubt: Context7 MCP

When working on a framework, dependency, or service integration in this repo and you are not certain of the current API surface — **always reach for Context7 MCP first.** The repo's `.config/opencode/AGENTS.md` makes this mandatory for library / framework / SDK / API / CLI / cloud-service questions.

Typical triggers in this codebase:

- Electron / `electron-updater` / `electron-builder` API changes (Context7: `/websites/electronjs`, `/electron/electron`, `/electron-userland/electron-builder`, `/electron-userland/electron-updater`).
- Vitest assertion / config changes (`/vitest-dev/vitest`).
- GitHub Actions trigger semantics / `softprops/action-gh-release` inputs (`/websites/github_en_actions`).
- Flatpak manifest / `flatpak-builder` flags (`/flathub/flatpak-builder`).
- pnpm 10 behavior (`.npmrc` semantics, hoist modes, lifecycle scripts) (`/pnpm/pnpm`).
- tsup / tsdown / esbuild bundling options (`/egoist/tsdown`).
- Vite / frontend bundling inside the staged `dsh-web-frontend` (`/vitejs/vite`).

Resolution flow: `mcp__context_resolve_library_id` → pick best match (high source reputation + benchmark) → `mcp__context_query_docs` with a **single concept per call** (split multi-topic questions). Use Context7 over web search for these — Context7 returns version-pinned, source-verified docs and is the canonical reference per the harness rules.

## Editing this file

Keep rules self-contained; link docs (`docs/desktop.md`) for high-level context. When bumping `package.json#version` for a release, also update the `<releases>` block in `flatpak/io.github.tduarte.dsh-desktop.metainfo.xml`.
