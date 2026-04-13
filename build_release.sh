#!/usr/bin/env bash
# build_release.sh — packages SpeedHack into a Decky-installable zip
#
# Compiles libspeedhack.so inside Valve's Steam Runtime SDK Docker image
# so the binary is guaranteed compatible with the Steam Deck environment.
#
# Requirements: docker (or podman), nodejs/npm, gcc (fallback)

set -euo pipefail

PLUGIN_NAME="SpeedHack"
BUILD_DIR="build/${PLUGIN_NAME}"
ZIP_NAME="${PLUGIN_NAME}.zip"

# Steam Runtime Sniper SDK — same environment games run in on Steam Deck
STEAM_SDK_IMAGE="registry.gitlab.steamos.cloud/steamrt/sniper/sdk:latest"

echo "==> Cleaning previous build..."
rm -rf build "${ZIP_NAME}"

echo "==> Installing JS dependencies..."
npm install --legacy-peer-deps --silent

echo "==> Building frontend..."
npm run build 2>&1 | grep -E "created|Error|error" || true

echo "==> Compiling libspeedhack.so..."
if docker info &>/dev/null 2>&1; then
    echo "    Using Steam Runtime SDK Docker image (Steam Deck compatible)"
    docker run --rm \
        -v "$(pwd)/speedhack:/work" \
        "${STEAM_SDK_IMAGE}" \
        gcc -shared -fPIC -O2 -o /work/libspeedhack.so /work/speedhack.c -ldl
    echo "    Compiled inside Steam Runtime SDK ✓"
else
    echo "    Docker not available — compiling with host gcc (may need rebuild on Deck)"
    gcc -shared -fPIC -O2 \
        -o speedhack/libspeedhack.so \
        speedhack/speedhack.c \
        -ldl
fi

echo "==> Assembling plugin folder..."
mkdir -p "${BUILD_DIR}/dist"
mkdir -p "${BUILD_DIR}/bin"
mkdir -p "${BUILD_DIR}/speedhack"

cp plugin.json              "${BUILD_DIR}/"
cp main.py                  "${BUILD_DIR}/"
cp dist/index.js            "${BUILD_DIR}/dist/"
cp speedhack/libspeedhack.so "${BUILD_DIR}/bin/"
cp speedhack/speedhack.c    "${BUILD_DIR}/speedhack/"
cp speedhack/Makefile       "${BUILD_DIR}/speedhack/"

echo "==> Creating ${ZIP_NAME}..."
cd build
if command -v zip &>/dev/null; then
    zip -r "../${ZIP_NAME}" "${PLUGIN_NAME}/"
    RESULT="${ZIP_NAME}"
else
    tar -czf "../${PLUGIN_NAME}.tar.gz" "${PLUGIN_NAME}/"
    RESULT="${PLUGIN_NAME}.tar.gz"
fi
cd ..

echo ""
echo "Done!  →  ${RESULT}"
echo ""
echo "Install on Steam Deck:"
echo "  1. Copy ${RESULT} to the Deck"
echo "  2. Decky → Developer → Install plugin from zip"
echo ""
echo "Usage on Steam Deck:"
echo "  1. Launch a game"
echo "  2. Open SpeedHack in Decky"
echo "  3. Click 'Enable for this game' (one-time per game, needs restart)"
echo "  4. After restart: toggle ON + adjust slider — works live"
