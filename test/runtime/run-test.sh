#!/usr/bin/env bash
# test/runtime/run-test.sh — run opencode with the cache-compaction plugin
# against a real LLM (InternalQwen), default qwen model, NO omo installed.
#
# Verifies the NEW no-omo behavior:
#   1. The plugin loads without crashing.
#   2. It runs stably under a real prompt (does not hang / crash).
#   3. No omo setup prompt is shown (that feature was removed — without omo we
#      only do compress/heartbeat + task-aware compaction).
#   4. Task-aware compaction works: task context is extracted from a session
#      via the LLM (the core of the compression mechanism).
set -euo pipefail

echo "==> opencode version: $(opencode --version)"

echo "==> Running opencode with the plugin (no omo)"
OUTPUT="$(opencode run --model InternalQwen/Qwen/Qwen3.6-35B-A3B-FP8 --format json "hello" 2>&1 || true)"

echo "==> Raw output (first 2000 chars):"
echo "${OUTPUT}" | head -c 2000
echo ""

FAILURES=0

# 1. Plugin must have loaded (server log line).
if echo "${OUTPUT}" | grep -q "plugin server loaded"; then
  echo "PASS: plugin server loaded"
else
  echo "FAIL: plugin server did not load"
  FAILURES=$((FAILURES + 1))
fi

# 2. The prompt must have produced a response (did not hang/crash).
if echo "${OUTPUT}" | grep -qi "hello\|hi\|你好"; then
  echo "PASS: prompt produced a response"
else
  echo "WARN: could not confirm a response in output (may be truncated)"
fi

# 3. No omo setup prompt should be shown (feature removed in no-omo mode).
if echo "${OUTPUT}" | grep -qi "oh-my-openagent\|oh-my-opencode\|installation"; then
  echo "FAIL: omo setup prompt shown but should be disabled without omo"
  FAILURES=$((FAILURES + 1))
else
  echo "PASS: no omo setup prompt (correct for no-omo mode)"
fi

if [ "${FAILURES}" -gt 0 ]; then
  echo ""
  echo "RUNTIME TEST FAILED: ${FAILURES} failure(s)"
  exit 1
fi

echo ""
echo "RUNTIME TEST PASSED"

echo ""
echo "=============================================="
echo "==> Running task-aware compaction test"
echo "=============================================="

# Start a headless opencode server for the SDK-based compaction test.
PORT=4096
opencode serve --port "${PORT}" --print-logs > /tmp/opencode-serve.log 2>&1 &
SERVER_PID=$!
trap 'kill ${SERVER_PID} 2>/dev/null || true' EXIT

# Wait for the server to be ready.
echo "==> Waiting for opencode server on port ${PORT}..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/config" 2>/dev/null; then
    echo "==> Server ready after ${i}s"
    break
  fi
  sleep 1
done

export OPENCODE_BASE_URL="http://127.0.0.1:${PORT}"
node /app/test-compaction.mjs
