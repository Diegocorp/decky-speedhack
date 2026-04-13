#!/usr/bin/env bash
# build_release.sh — packages SpeedHack into a Decky-installable zip
#
# What it does:
#   1. Installs JS deps and builds dist/index.js (the React UI)
#   2. Compiles libspeedhack.so (x86_64 Linux — same arch as Steam Deck)
#   3. Bundles everything into SpeedHack.zip with the correct folder layout
#
# Usage:
#   chmod +x build_release.sh
#   ./build_release.sh
#
# Then copy SpeedHack.zip to the Steam Deck and install via:
#   Decky → Developer → Install plugin from zip

set -euo pipefail

PLUGIN_NAME="SpeedHack"
DIST_DIR="dist"
BUILD_DIR="build/${PLUGIN_NAME}"
ZIP_NAME="${PLUGIN_NAME}.zip"
TAR_NAME="${PLUGIN_NAME}.tar.gz"

echo "==> Cleaning previous build..."
rm -rf build "${ZIP_NAME}"

echo "==> Installing JS dependencies..."
npm install --legacy-peer-deps --silent

echo "==> Building frontend (TypeScript → dist/index.js)..."
npm run build 2>&1 | grep -v "^(node:" || true   # suppress node ESM warning

echo "==> Compiling libspeedhack.so..."
gcc -shared -fPIC -O2 \
    -o speedhack/libspeedhack.so \
    speedhack/speedhack.c \
    -ldl

echo "==> Assembling plugin folder..."
mkdir -p "${BUILD_DIR}/dist"
mkdir -p "${BUILD_DIR}/bin"
mkdir -p "${BUILD_DIR}/speedhack"

# Required by Decky
cp plugin.json   "${BUILD_DIR}/"
cp main.py       "${BUILD_DIR}/"
cp dist/index.js "${BUILD_DIR}/dist/"

# Pre-built library (auto-loaded on first run, avoids needing gcc on Deck)
cp speedhack/libspeedhack.so "${BUILD_DIR}/bin/"

# Source kept in package so the "Build & Install Library" button still works
cp speedhack/speedhack.c  "${BUILD_DIR}/speedhack/"
cp speedhack/Makefile     "${BUILD_DIR}/speedhack/"

echo "==> Creating archives..."
# zip (preferred by Decky) — use if available, else fall back to tar.gz
cd build
if command -v zip &>/dev/null; then
    zip -r "../${ZIP_NAME}" "${PLUGIN_NAME}/"
    RESULT="${ZIP_NAME}"
else
    tar -czf "../${TAR_NAME}" "${PLUGIN_NAME}/"
    RESULT="${TAR_NAME}"
fi
cd ..

echo ""
echo "Done!  →  ${RESULT}"
echo ""
echo "Install on Steam Deck:"
echo "  1. Copy ${RESULT} to the Deck (USB, scp, etc.)"
echo "  2. Decky menu → Developer → Install plugin from zip"
echo "  3. Select ${RESULT} — done."
