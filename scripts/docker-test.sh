#!/usr/bin/env bash
# scripts/docker-test.sh — build & run the plugin smoke test inside a container.
#
# Verifies the plugin loads inside a clean container with a real opencode
# runtime and does not crash / run away under adversarial event streams.
#
# Usage:   bash scripts/docker-test.sh
# Requires: podman or docker on the host (podman preferred, auto-detected).
set -euo pipefail

IMAGE="cache-compaction-test:local"

# Auto-detect the container runtime: prefer podman, fall back to docker.
if command -v podman >/dev/null 2>&1; then
  RUNTIME="podman"
elif command -v docker >/dev/null 2>&1; then
  RUNTIME="docker"
else
  echo "ERROR: neither podman nor docker found on PATH." >&2
  exit 1
fi
echo "==> Using container runtime: ${RUNTIME}"

echo "==> Building image ${IMAGE}"
"${RUNTIME}" build -t "${IMAGE}" .

echo "==> Running smoke test in container"
"${RUNTIME}" run --rm "${IMAGE}"

echo "==> Container smoke test PASSED"
