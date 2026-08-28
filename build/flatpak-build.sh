#!/usr/bin/env bash
# Build a Flatpak bundle for DSH Desktop.
#
# Inputs:
#   1. The prebuilt Electron archive (the `--tarball` argument) produced by
#      `pnpm run dist:linux` (writes to `dist/DSH-Desktop-<version>-linux-x64.tar.gz`).
#   2. `flatpak/io.github.tduarte.dsh-desktop.yml` — the Flatpak manifest.
#
# This script:
#   - Renders a build-local copy of the manifest with `${VERSION}` substituted.
#     The original manifest under `flatpak/` is never modified.
#   - Runs `flatpak-builder` against the rendered manifest (which reads the
#     tarball directly via a relative `path:` source).
#   - Exports the OSTree repo at `<version>` and bundles it as a `.flatpak`.
#   - Tars the OSTree repo so users can `flatpak remote-add --from repo.tar.gz`
#     and `flatpak update`.
#
# Env:
#   VERSION                app version (default: package.json#version)
#   FLATPAK_REPO           output repo dir (default: build/flatpak-out/repo)
#   FLATPAK_BUNDLE         output .flatpak (default: build/flatpak-out/DSH-Desktop-<version>.flatpak)
#   FLATPAK_USER_INSTALL   pass `1`/`true` to install deps into the user
#                         flatpak install (default; required for non-root CI
#                         runners). Pass `0`/`false` to install system-wide
#                         (requires sudo / root).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="io.github.tduarte.dsh-desktop"
VERSION="${VERSION:-$(node -e "console.log(require('${REPO_ROOT}/package.json').version)")}"
OUT_DIR="${OUT_DIR:-${REPO_ROOT}/build/flatpak-out}"
TARBALL="${1:-${REPO_ROOT}/dist/DSH-Desktop-${VERSION}-linux-x64.tar.gz}"
FLATPAK_REPO="${FLATPAK_REPO:-${OUT_DIR}/repo}"
FLATPAK_BUILD_DIR="${FLATPAK_BUILD_DIR:-${OUT_DIR}/build}"
FLATPAK_BUNDLE="${FLATPAK_BUNDLE:-${OUT_DIR}/DSH-Desktop-${VERSION}.flatpak}"
MANIFEST_SRC="${REPO_ROOT}/flatpak/${APP_ID}.yml"
MANIFEST_RENDERED="${REPO_ROOT}/flatpak/${APP_ID}.rendered.yml"

# Default to a user-mode flatpak install: CI runners are non-root, and
# flatpak-builder's default `--system` requires sudo. Override by exporting
# FLATPAK_USER_INSTALL=0 when running as root against a system install.
FLATPAK_USER_INSTALL="${FLATPAK_USER_INSTALL:-1}"
FLATPAK_BUILDER_USER_FLAG=()
if [[ "${FLATPAK_USER_INSTALL}" =~ ^([1Tt][Rr]?[Uu]?[Ee]?|yes|on)$ ]]; then
  FLATPAK_BUILDER_USER_FLAG=(--user)
fi
echo "flatpak: out=${OUT_DIR}"

if ! command -v flatpak-builder >/dev/null; then
  echo "flatpak-builder not found; install with: sudo apt install flatpak-builder" >&2
  exit 1
fi

if [[ ! -f "${TARBALL}" ]]; then
  echo "flatpak: tarball not found at ${TARBALL}" >&2
  echo "flatpak: run \`pnpm run dist:linux\` first to produce it" >&2
  exit 1
fi

if [[ ! -f "${MANIFEST_SRC}" ]]; then
  echo "flatpak: manifest not found at ${MANIFEST_SRC}" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}" "${FLATPAK_BUILD_DIR}"

# Render the manifest: substitute ${VERSION}. (The tarball reference is a
# plain `path:` source, so no placeholder substitution for its checksum.)
sed \
  -e "s|\${VERSION}|${VERSION}|g" \
  "${MANIFEST_SRC}" > "${MANIFEST_RENDERED}"

echo "flatpak: tarball=${TARBALL} ($(stat --printf='%s' "${TARBALL}") bytes)"
echo "flatpak: flatpak-builder..."
flatpak-builder --force-clean \
  "${FLATPAK_BUILDER_USER_FLAG[@]}" \
  --install-deps-from=flathub \
  --repo="${FLATPAK_REPO}" \
  "${FLATPAK_BUILD_DIR}" \
  "${MANIFEST_RENDERED}"

echo "flatpak: build-export..."
flatpak build-export \
  "${FLATPAK_REPO}" \
  "${FLATPAK_BUILD_DIR}" \
  "${VERSION}"

echo "flatpak: build-bundle..."
flatpak build-bundle \
  "${FLATPAK_REPO}" \
  "${FLATPAK_BUNDLE}" \
  "${APP_ID}" \
  "${VERSION}"
echo "flatpak: taring repo..."
tar -C "${FLATPAK_REPO}" -czf "${OUT_DIR}/repo.tar.gz" .

echo "flatpak: done"
echo "  bundle: ${FLATPAK_BUNDLE}"
echo "  repo:   ${OUT_DIR}/repo.tar.gz"
echo "  manifest: ${MANIFEST_RENDERED}"