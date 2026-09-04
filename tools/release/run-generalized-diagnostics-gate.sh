#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ "${1:-}" == "--dry-run" ]]; then
  node --input-type=module -e 'import {readCommands} from "./tools/release/release-evidence.mjs"; console.log(readCommands(process.cwd()).join("\n"))'
  exit 0
fi

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

# Read-only preflight leaves existing evidence untouched. Any actual new gate
# attempt invalidates it before runtime checks, including a failed preflight.
if [[ "${1:-}" != "--preflight-only" ]]; then rm -f .release/attestation.json; fi

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

node --input-type=module -e 'import {cleanSourceSha,readCommands} from "./tools/release/release-evidence.mjs"; cleanSourceSha(process.cwd()); readCommands(process.cwd())'

GATE_TMP="$(mktemp -d "${TMPDIR:-/tmp}/actuarial-ts-release-gate.XXXXXX")"
GATE_PYTHON="$GATE_TMP/venv/bin/python"
SIDECAR_LOG="$GATE_TMP/sidecar.log"
echo "release gate temp: $GATE_TMP"
"$PYTHON312_BIN" -m venv "$GATE_TMP/venv"
"$GATE_PYTHON" -m pip install --upgrade pip
"$GATE_PYTHON" -m pip install -e "interop/python[chainladder]" pytest
"$GATE_PYTHON" -m pip install -r interop/sidecar/requirements-dev.txt
"$GATE_PYTHON" -m pip check
"$GATE_PYTHON" tools/release/check-python-environment.py
PYTHONPATH="$PWD/interop:$PWD/tools/release" "$GATE_PYTHON" -m pytest -p reject_skips interop/sidecar/tests tools/release/test-check-sidecar-engine.py tools/release/test-check-python-environment.py tools/release/test-reject-skips.py -q

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

ACTUARIAL_TS_GATE_PYTHON="$GATE_PYTHON" node tools/release/execute-gate.mjs
