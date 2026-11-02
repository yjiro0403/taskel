#!/usr/bin/env bash
# Starts Ollama, ComfyUI and the Local Imagine web app together and stops them all on Ctrl-C.
#
#   bash scripts/start-all.sh [comfyui-dir]
#
# Environment overrides: COMFY_PORT (8188), APP_PORT (3100), COMFY_ARGS (extra ComfyUI flags)
# Note: OLLAMA_URL / COMFYUI_URL only seed data/settings.json on first run; afterwards the
# URLs in the app's Settings dialog are the source of truth. .env.local is honoured if present.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMFY_DIR="${1:-$APP_DIR/../ComfyUI}"
COMFY_PORT="${COMFY_PORT:-8188}"
APP_PORT="${APP_PORT:-3100}"
PIDS=()
# ${PIDS[@]+...} keeps bash 3.2 (macOS /bin/bash) happy with set -u when the array is empty
cleanup() { echo; echo "==> stopping"; for p in ${PIDS[@]+"${PIDS[@]}"}; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

# Load .env.local so URL overrides there are respected
if [ -f "$APP_DIR/.env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$APP_DIR/.env.local"
  set +a
fi
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
COMFYUI_URL="${COMFYUI_URL:-http://127.0.0.1:$COMFY_PORT}"

# 1. Ollama (skip if the menu-bar app is already serving)
if curl -sf "$OLLAMA_URL/api/version" >/dev/null; then
  echo "==> Ollama already running"
else
  echo "==> starting ollama serve"
  ollama serve >"$APP_DIR/ollama.log" 2>&1 &
  PIDS+=($!)
fi

# 2. ComfyUI
if curl -sf "$COMFYUI_URL/system_stats" >/dev/null; then
  echo "==> ComfyUI already running on :$COMFY_PORT"
else
  echo "==> starting ComfyUI from $COMFY_DIR on :$COMFY_PORT"
  (
    cd "$COMFY_DIR"
    # shellcheck disable=SC1091
    source venv/bin/activate
    # PYTORCH_ENABLE_MPS_FALLBACK lets unsupported Metal ops run on the CPU instead of crashing.
    PYTORCH_ENABLE_MPS_FALLBACK=1 exec python main.py \
      --listen 127.0.0.1 --port "$COMFY_PORT" --disable-auto-launch --preview-method auto ${COMFY_ARGS:-}
  ) >"$APP_DIR/comfyui.log" 2>&1 &
  PIDS+=($!)
fi

# 3. the app
cd "$APP_DIR"
if [ ! -d node_modules ]; then npm install; fi
export OLLAMA_URL COMFYUI_URL
echo "==> Local Imagine: http://localhost:$APP_PORT  (logs: ollama.log, comfyui.log)"
npx next dev -p "$APP_PORT"
