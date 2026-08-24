#!/usr/bin/env bash
# WP-9: local Windows installer build from WSL2 via the electron-builder Wine
# container (electronuserland/builder:wine). Mirrors package-windows.yml.
#
# Usage: npm run package:win:local
# Output: release/Echocue Setup <ver>.exe (+ manifest/hashes + compliance).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="electronuserland/builder:wine"

echo "==> preflight"
if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found — install Docker Desktop and enable WSL integration, or run: sudo apt install docker.io" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not running — start Docker Desktop (or: sudo service docker start) and retry" >&2
  exit 1
fi
if [ ! -d "$REPO_ROOT/node_modules" ]; then
  echo "node_modules missing — run 'npm ci' first (or let the container install it)" >&2
fi

echo "==> running CI-equivalent build inside ${IMAGE}"
# Non-root user so release/ artifacts are not root-owned. The container downloads
# the Windows electron/NSIS binaries on first run (build-time download only; the
# packaged app never downloads at runtime — A-09).
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$REPO_ROOT":/project \
  -w /project \
  "$IMAGE" \
  bash -lc 'npm ci && npm run build && npm run typecheck && npm run compliance && npm run icons && npm run package:win && npm run release:manifest'

echo "==> done"
if command -v wslpath >/dev/null 2>&1 && command -v wslvar >/dev/null 2>&1; then
  INSTALLER="$(ls "$REPO_ROOT"/release/Echocue\ Setup*.exe 2>/dev/null | head -1 || true)"
  if [ -n "$INSTALLER" ]; then
    echo "Windows path: \\\\wsl.localhost\\$(hostname)\\$(wslpath -m "$INSTALLER" | sed 's#^/##; s#/#\\#g')"
    echo "Double-click to install, or run 'start.exe \"$INSTALLER\"'."
  fi
fi
