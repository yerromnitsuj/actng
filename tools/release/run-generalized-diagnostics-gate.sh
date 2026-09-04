#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMMANDS=(
  "npm run version:check" "npm ci" "npm run version:check" "npm run release:gate:test"
  "npm run build" "npm run typecheck" "npm test" "pytest:all"
  "R:conformance" "R:read-document" "npm run crosscheck:ci"
  "npm run diagnostics:legacy:test" "npm run diagnostics:legacy:check -- --scope=source,declarations"
  "npm run docs:check" "npm run docs:check:py" "npm run docs:check:r"
  "npm run advisories:test" "npm run advisories:check" "npm run smoke:packed:test"
  "npm run example" "npm run example:real-world" "npm run example:determinism"
  "npm run example:cl-ts" "npm run example:cl-py" "npm run example:cl-r"
  "npm run example:cl-crosscheck" "npm run smoke:packed" "npm run smoke:packed:runtime-four"
)
if [[ "${1:-}" == "--dry-run" ]]; then printf '%s\n' "${COMMANDS[@]}"; exit 0; fi

GATE_TMP=""
GATE_PYTHON=""
SIDECAR_LOG=""
SIDECAR_PID=""
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "${SIDECAR_PID:-}" ]] && kill -0 "$SIDECAR_PID" 2>/dev/null; then
    kill "$SIDECAR_PID" 2>/dev/null || true
    for attempt in {1..20}; do
      kill -0 "$SIDECAR_PID" 2>/dev/null || break
      sleep 0.05
      kill "$SIDECAR_PID" 2>/dev/null || true
    done
    if kill -0 "$SIDECAR_PID" 2>/dev/null; then kill -KILL "$SIDECAR_PID" 2>/dev/null || true; fi
    wait "$SIDECAR_PID" 2>/dev/null || true
  fi
  if [[ "$status" -ne 0 && -n "${SIDECAR_LOG:-}" && -f "$SIDECAR_LOG" ]]; then
    sed -n '1,240p' "$SIDECAR_LOG" >&2
  fi
  if [[ -n "${GATE_TMP:-}" && -d "$GATE_TMP" ]]; then rm -rf -- "$GATE_TMP"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The focused test invokes the real cleanup/trap implementation without
# installing dependencies or starting the sidecar. Production cannot select
# these modes because the explicit test authority variable is also required.
if [[ "${ACTUARIAL_TS_GATE_TESTING:-}" == "1" && "${1:-}" == --cleanup-self-test=* ]]; then
  scenario="${1#*=}"
  if [[ "$scenario" == "pre-allocation-interrupt" ]]; then kill -INT "$$"; fi
  GATE_TMP="$(mktemp -d "${TMPDIR:-/tmp}/actuarial-ts-release-gate-test.XXXXXX")"
  SIDECAR_LOG="$GATE_TMP/sidecar.log"
  sleep 30 >"$SIDECAR_LOG" 2>&1 & SIDECAR_PID=$!
  echo "release gate temp: $GATE_TMP"
  echo "release gate child: $SIDECAR_PID"
  case "$scenario" in
    success) exit 0 ;;
    failure) exit 9 ;;
    post-allocation-interrupt) kill -INT "$$" ;;
    *) echo "unknown cleanup self-test scenario" >&2; exit 2 ;;
  esac
fi

PYTHON312_BIN="${ACTUARIAL_TS_PYTHON312:-python3.12}"
"$PYTHON312_BIN" -c 'import sys; v=sys.version_info[:2]; sys.exit(f"requires Python 3.12, got {sys.version}") if v != (3, 12) else print(sys.version)'
RSCRIPT_BIN="${ACTUARIAL_TS_RSCRIPT:-Rscript}"
if [[ "$RSCRIPT_BIN" == */* ]]; then
  [[ -x "$RSCRIPT_BIN" ]] || { echo "ACTUARIAL_TS_RSCRIPT is not executable: $RSCRIPT_BIN" >&2; exit 1; }
else
  RSCRIPT_BIN="$(command -v "$RSCRIPT_BIN")"
fi
export ACTUARIAL_TS_RSCRIPT="$RSCRIPT_BIN"
"$RSCRIPT_BIN" tools/interop/test-r-environment.R
"$RSCRIPT_BIN" tools/interop/check-r-environment.R
node -e 'if (process.versions.node !== "22.22.0") { console.error(`requires Node 22.22.0, got ${process.versions.node}`); process.exit(1) }'
if [[ "${1:-}" == "--preflight-only" ]]; then exit 0; fi

GATE_TMP="$(mktemp -d "${TMPDIR:-/tmp}/actuarial-ts-release-gate.XXXXXX")"
GATE_PYTHON="$GATE_TMP/venv/bin/python"
SIDECAR_LOG="$GATE_TMP/sidecar.log"
echo "release gate temp: $GATE_TMP"
"$PYTHON312_BIN" -m venv "$GATE_TMP/venv"
"$GATE_PYTHON" -m pip install --upgrade pip
"$GATE_PYTHON" -m pip install -e "interop/python[chainladder]" pytest
"$GATE_PYTHON" -m pip install -r interop/sidecar/requirements-dev.txt
"$GATE_PYTHON" -m pip check
"$GATE_PYTHON" - <<'PY'
from importlib.metadata import version
expected = {
    "chainladder": "0.9.2", "pandas": "2.3.3", "numpy": "2.4.6",
    "fastapi": "0.139.2", "uvicorn": "0.51.0", "httpx": "0.28.1",
}
for name, wanted in expected.items():
    actual = version(name)
    if actual != wanted:
        raise SystemExit(f"sidecar dependency mismatch: {name} expected {wanted}, got {actual}")
for path in ("interop/sidecar/requirements.txt", "interop/sidecar/requirements-dev.txt"):
    text = open(path, encoding="utf-8").read()
    for name, wanted in expected.items():
        if name in text and f"{name}=={wanted}" not in text:
            raise SystemExit(f"requirement pin drift: {name}=={wanted} absent from {path}")
PY
PYTHONPATH="$PWD/interop" "$GATE_PYTHON" -m pytest interop/sidecar/tests tools/release/test-check-sidecar-engine.py -q

SIDECAR_PORT="$("$GATE_PYTHON" -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
"$GATE_PYTHON" -c 'import socket,sys; s=socket.socket(); s.bind(("127.0.0.1",int(sys.argv[1]))); s.close()' "$SIDECAR_PORT"
export SIDECAR_PORT SIDECAR_URL="http://127.0.0.1:$SIDECAR_PORT"
SIDECAR_TOKEN="$("$GATE_PYTHON" -c 'import secrets; print(secrets.token_urlsafe(32))')"
export SIDECAR_TOKEN
PYTHONPATH="$PWD/interop" SIDECAR_TOKEN="$SIDECAR_TOKEN" "$GATE_PYTHON" -m sidecar >"$SIDECAR_LOG" 2>&1 &
SIDECAR_PID=$!
SIDECAR_READY=0
for attempt in {1..60}; do
  if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then echo "sidecar exited before becoming healthy" >&2; exit 1; fi
  if ENGINE_JSON="$(curl -sf --connect-timeout 1 --max-time 2 -H "Authorization: Bearer $SIDECAR_TOKEN" "$SIDECAR_URL/v1/engine")" && printf '%s' "$ENGINE_JSON" | PYTHONPATH="$PWD/interop" "$GATE_PYTHON" tools/release/check-sidecar-engine.py; then
    SIDECAR_READY=1
    break
  fi
  sleep 1
done
[[ "$SIDECAR_READY" -eq 1 ]]
kill -0 "$SIDECAR_PID" 2>/dev/null
ENGINE_JSON="$(curl -sf --connect-timeout 1 --max-time 2 -H "Authorization: Bearer $SIDECAR_TOKEN" "$SIDECAR_URL/v1/engine")"
printf '%s' "$ENGINE_JSON" | PYTHONPATH="$PWD/interop" "$GATE_PYTHON" tools/release/check-sidecar-engine.py

npm run version:check
npm ci
npm run version:check
npm run release:gate:test
npm run build
npm run typecheck
npm test
"$GATE_PYTHON" -m pytest interop/python/tests interop/conformance/py interop/sidecar/tests -q
"$RSCRIPT_BIN" tools/interop/conformance.R
"$RSCRIPT_BIN" tools/interop/test-read-document.R
npm run crosscheck:ci
npm run diagnostics:legacy:test
npm run diagnostics:legacy:check -- --scope=source,declarations
npm run docs:check
ACTUARIAL_TS_PYTHON="$GATE_PYTHON" npm run docs:check:py
npm run docs:check:r
npm run advisories:test
npm run advisories:check
npm run smoke:packed:test
npm run example
npm run example:real-world
npm run example:determinism
npm run example:cl-ts
npm run example:cl-py
npm run example:cl-r
npm run example:cl-crosscheck
npm run smoke:packed
npm run smoke:packed:runtime-four
