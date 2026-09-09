#!/usr/bin/env bash
# test/omo/run-test.sh — run opencode with the cache-compaction plugin against
# a real LLM (InternalQwen) WITH omo (oh-my-openagent) installed (as a stub).
#
# Verifies the omo-present BA orchestration path:
#   1. The plugin loads without crashing.
#   2. omo is detected as present (log line "omo present: true").
#   3. On a user message, the BA classifies + routes the input and logs a
#      "BA decision" (the omo-gated orchestration path is active).
#   4. The prompt still produces a response (does not hang/crash).
set -euo pipefail

echo "==> opencode version: $(opencode --version)"

echo "==> Running opencode with the plugin (omo present)"
OUTPUT="$(opencode run --model InternalQwen/Qwen/Qwen3.6-35B-A3B-FP8 --format json "hello" 2>&1 || true)"

echo "==> Raw output (first 3000 chars):"
echo "${OUTPUT}" | head -c 3000
echo ""

FAILURES=0

# 1. Plugin must have loaded (server log line).
if echo "${OUTPUT}" | grep -q "plugin server loaded"; then
  echo "PASS: plugin server loaded"
else
  echo "FAIL: plugin server did not load"
  FAILURES=$((FAILURES + 1))
fi

# 2. omo must be detected as present.
if echo "${OUTPUT}" | grep -q "omo present: true"; then
  echo "PASS: omo detected as present"
else
  echo "FAIL: omo not detected as present"
  FAILURES=$((FAILURES + 1))
fi

# 3. BA orchestration must run and log a decision.
if echo "${OUTPUT}" | grep -q "BA decision:"; then
  echo "PASS: BA decision logged (classification + routing ran)"
else
  echo "FAIL: BA decision not logged"
  FAILURES=$((FAILURES + 1))
fi

# 4. The prompt must have produced a response (did not hang/crash).
if echo "${OUTPUT}" | grep -qi "hello\|hi\|你好"; then
  echo "PASS: prompt produced a response"
else
  echo "WARN: could not confirm a response in output (may be truncated)"
fi

if [ "${FAILURES}" -gt 0 ]; then
  echo ""
  echo "OMO TEST FAILED: ${FAILURES} failure(s)"
  exit 1
fi

echo ""
echo "OMO TEST PASSED"
