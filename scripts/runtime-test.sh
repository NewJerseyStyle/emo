#!/usr/bin/env bash
# scripts/runtime-test.sh — build & run the plugin against a real opencode
# runtime + real LLM (InternalQwen), default qwen model, NO omo installed.
#
# Verifies the plugin loads, runs stably, and shows the omo setup prompt when
# omo is absent.
#
# Usage:   bash scripts/runtime-test.sh
# Requires: podman or docker, and the host opencode binary at
#           ~/.opencode/bin/opencode (or $OPENCODE_BIN).
set -euo pipefail

if command -v podman >/dev/null 2>&1; then
  RUNTIME="podman"
elif command -v docker >/dev/null 2>&1; then
  RUNTIME="docker"
else
  echo "ERROR: neither podman nor docker found on PATH." >&2
  exit 1
fi
echo "==> Using container runtime: ${RUNTIME}"

OPENCODE_BIN="${OPENCODE_BIN:-$HOME/.opencode/bin/opencode}"
if [ ! -f "${OPENCODE_BIN}" ]; then
  echo "ERROR: opencode binary not found at ${OPENCODE_BIN}" >&2
  echo "Set OPENCODE_BIN to the standalone opencode binary path." >&2
  exit 1
fi

# The Dockerfile.runtime copies the host binary into the image; stage it into
# the build context first (gitignored, not committed).
STAGED="test/runtime/bin/opencode"
mkdir -p "$(dirname "${STAGED}")"
cp "${OPENCODE_BIN}" "${STAGED}"
trap 'rm -rf test/runtime/bin' EXIT

echo "==> Building image cache-compaction-runtime"
"${RUNTIME}" build -f Dockerfile.runtime -t cache-compaction-runtime .

echo "==> Running runtime test in container"
"${RUNTIME}" run --rm cache-compaction-runtime
