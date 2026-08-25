#!/bin/sh
# Wrapper for the bundled Electron app under Flatpak.
#
# The Electron2 BaseApp replaces Chromium's setuid sandbox with zypak:
# it places the Electron binary under the bwrap sandbox without competing
# for setuid bits. `zypak-wrapper.sh` is on $PATH (inherited from the
# base at /app/bin).
#
# Layout after install (apply_extra extracts the extra-data tarball):
#   /app/dsh-desktop/
#     electron-app/node_modules/.bin/electron
#     electron-app/lib/main.cjs
#     electron-app/lib/preload.cjs
#     resources/dsh/   (bundled @deepseek-ai/dsh CLI)
#     resources/dist/  (Vite frontend)

set -eu

APP_DIR=/app/dsh-desktop
ELECTRON="${APP_DIR}/electron-app/node_modules/.bin/electron"

exec zypak-wrapper.sh "${ELECTRON}" \
  --no-sandbox \
  "${APP_DIR}/electron-app" \
  "$@"
