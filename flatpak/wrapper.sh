#!/bin/sh
# Wrapper for the bundled Electron app under Flatpak.
#
# Chromium's setuid sandbox cannot run inside Flatpak's Bubblewrap sandbox —
# the two compete for the same setuid bits. Disable Chromium's; rely on
# Bubblewrap for the trust fence. Every Electron app on Flathub does this.
#
# Also: route node module resolution to the Electron app's vendored tree.

set -eu

export ELECTRON_DISABLE_SANDBOX=1
export NODE_PATH=/app/dsh-desktop/node_modules
export PATH=/app/dsh-desktop/node_modules/.bin:/usr/bin:/bin

exec /app/dsh-desktop/node_modules/.bin/electron --no-sandbox /app/dsh-desktop "$@"