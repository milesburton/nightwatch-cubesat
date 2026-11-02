#!/usr/bin/env bash
# Build the arm64 images on this machine and load them onto the Pi. Needs no registry login.
#
#   scripts/build-arm64-for-pi.sh [user@host] [--base-only | --app-only]
#
# Uses QEMU emulation (binfmt aarch64 must be registered: `docker run --privileged --rm
# tonistiigi/binfmt --install arm64`), so the first base build compiles gr-satellites under
# emulation and is slow. Layers are cached afterwards. The image is copied with rsync
# --partial so a dropped Wi-Fi link resumes instead of restarting.
set -euo pipefail

TARGET="${1:-miles@192.168.1.104}"
MODE="${2:-all}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

BASE=nightwatch-cubesat-base:arm64
APP=nightwatch-cubesat:arm64
ARCHIVE="${TMPDIR:-/tmp}/nightwatch-cubesat-arm64.tar.gz"

if [[ "$MODE" != "--app-only" ]]; then
  docker buildx build --platform linux/arm64 --load -f docker/Dockerfile.base -t "$BASE" .
fi
if [[ "$MODE" != "--base-only" ]]; then
  docker buildx build --platform linux/arm64 --load -f docker/Dockerfile.app \
    --build-arg "BASE_IMAGE=$BASE" --build-arg "GIT_COMMIT=$(git rev-parse --short HEAD)" \
    --build-arg "BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)" -t "$APP" .
  images=("$APP")
else
  images=("$BASE")
fi

docker save "${images[@]}" | gzip > "$ARCHIVE"
rsync -t --partial --inplace --timeout=60 --info=progress2 "$ARCHIVE" "$TARGET:/tmp/"
ssh "$TARGET" "gunzip -c /tmp/$(basename "$ARCHIVE") | docker load && rm /tmp/$(basename "$ARCHIVE")"
echo "Loaded ${images[*]} on $TARGET"
