#!/bin/sh
# Wrapper for the bundled Electron app under Flatpak.
#
# The Electron2 BaseApp replaces Chromium's setuid sandbox with zypak:
# it places the Electron binary under the bwrap sandbox without competing
# for setuid bits. `zypak-wrapper.sh` is on $PATH (inherited from the
# base at /app/bin).
#
# Layout after install (the manifest extracts the tarball at build time):
#   /app/dsh-desktop/
#     electron-app/node_modules/electron/dist/dsh-desktop  (Electron binary)
#     electron-app/node_modules/electron/dist/resources/   (app payload)
#
APP_DIR=/app/dsh-desktop
ELECTRON="${APP_DIR}/electron-app/node_modules/electron/dist/dsh-desktop"

exec zypak-wrapper.sh "${ELECTRON}" \
  --no-sandbox \
  "$@"
