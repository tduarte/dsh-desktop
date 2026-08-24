#!/usr/bin/env bash
# Build a Flatpak bundle for DeepSeek Harness desktop.
#
# Inputs:
#   1. The prebuilt Electron archive (the `--tarball` argument) produced by
#      `pnpm run dist:linux` (writes to `dist/DeepSeek-Harness-<version>-linux-x64.tar.gz`).
#   2. `flatpak/ai.deepseek.harness.desktop.yml` — the Flatpak manifest with
#      `REPLACE_WITH_SHA512` and `REPLACE_WITH_SIZE` placeholders.
#
# This script:
#   - Verifies the tarball exists and computes its sha512 + byte size.
#   - Stages the tarball at `build/flatpak-out/dsh-desktop.tar.gz` (matching the
#     manifest's `filename:` field).
#   - Renders the manifest into a build-local copy with the placeholders filled
#     in. The original manifest under `flatpak/` is never modified.
#   - Runs `flatpak-builder` against the rendered manifest.
#   - Exports the OSTree repo at `<version>` and bundles it as a `.flatpak`.
#   - Tars the OSTree repo so users can `flatpak remote-add --from repo.tar.gz`
#     and `flatpak update`.
#
# Env:
#   VERSION         app version (default: package.json#version)
#   FLATPAK_REPO    output repo dir (default: build/flatpak-out/repo)
#   FLATPAK_BUNDLE  output .flatpak (default: build/flatpak-out/DeepSeek-Harness-<version>.flatpak)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="ai.deepseek.harness.desktop"
VERSION="${VERSION:-$(node -e "console.log(require('${REPO_ROOT}/package.json').version)")}"
OUT_DIR="${OUT_DIR:-${REPO_ROOT}/build/flatpak-out}"
TARBALL="${1:-${REPO_ROOT}/dist/DeepSeek-Harness-${VERSION}-linux-x64.tar.gz}"
FLATPAK_REPO="${FLATPAK_REPO:-${OUT_DIR}/repo}"
FLATPAK_BUILD_DIR="${FLATPAK_BUILD_DIR:-${OUT_DIR}/build}"
FLATPAK_BUNDLE="${FLATPAK_BUNDLE:-${OUT_DIR}/DeepSeek-Harness-${VERSION}.flatpak}"
MANIFEST_SRC="${REPO_ROOT}/flatpak/${APP_ID}.yml"
MANIFEST_RENDERED="${REPO_ROOT}/flatpak/${APP_ID}.rendered.yml"

echo "flatpak: version=${VERSION}"
echo "flatpak: tarball=${TARBALL}"
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

# Stage the tarball at the path the manifest's `filename:` field expects.
cp "${TARBALL}" "${OUT_DIR}/dsh-desktop.tar.gz"

# Compute sha512 + size.
SHA512="$(sha512sum "${TARBALL}" | awk '{print $1}')"
SIZE="$(stat --printf='%s' "${TARBALL}")"
echo "flatpak: sha512=${SHA512}"
echo "flatpak: size=${SIZE}"

# Render the manifest: substitute placeholders.
sed \
  -e "s|REPLACE_WITH_SHA512|${SHA512}|g" \
  -e "s|REPLACE_WITH_SIZE|${SIZE}|g" \
  -e "s|\${VERSION}|${VERSION}|g" \
  "${MANIFEST_SRC}" > "${MANIFEST_RENDERED}"

echo "flatpak: flatpak-builder..."
flatpak-builder --force-clean \
  --install-deps-from=flathub \
  --repo="${FLATPAK_REPO}" \
  "${FLATPAK_BUILD_DIR}" \
  "${MANIFEST_RENDERED}"

echo "flatpak: build-export..."
flatpak build-export \
  --runtime-url=https://dl.flathub.org/electron/ \
  "${FLATPAK_REPO}" \
  "${FLATPAK_BUILD_DIR}" \
  "${VERSION}"

echo "flatpak: build-bundle..."
flatpak build-bundle \
  --runtime-url=https://dl.flathub.org/electron/ \
  "${FLATPAK_REPO}" \
  "${FLATPAK_BUNDLE}" \
  "${VERSION}"

# Tar the OSTree repo so users can `flatpak remote-add --from` for updates.
echo "flatpak: taring repo..."
tar -C "${FLATPAK_REPO}" -czf "${OUT_DIR}/repo.tar.gz" .

echo "flatpak: done"
echo "  bundle: ${FLATPAK_BUNDLE}"
echo "  repo:   ${OUT_DIR}/repo.tar.gz"
echo "  manifest: ${MANIFEST_RENDERED}"