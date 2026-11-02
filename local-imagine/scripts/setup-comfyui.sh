#!/usr/bin/env bash
# Installs ComfyUI for Apple Silicon (M1/M2/M3/M4) next to this app, with the custom nodes
# Local Imagine can use. Safe to re-run: existing clones are updated, not replaced.
#
#   bash scripts/setup-comfyui.sh [install-dir]      (default: ../ComfyUI relative to local-imagine)
#
# Requirements: macOS 14+, Xcode Command Line Tools (xcode-select --install), Python 3.10-3.12
# (brew install python@3.12), git.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMFY_DIR="${1:-$APP_DIR/../ComfyUI}"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3.12 || command -v python3.11 || command -v python3.10 || command -v python3)}"

echo "==> ComfyUI dir : $COMFY_DIR"
echo "==> Python      : $PYTHON_BIN ($("$PYTHON_BIN" --version))"

if [ ! -d "$COMFY_DIR/.git" ]; then
  git clone https://github.com/comfyanonymous/ComfyUI "$COMFY_DIR"
else
  git -C "$COMFY_DIR" pull --ff-only || true
fi

cd "$COMFY_DIR"
if [ ! -d venv ]; then
  "$PYTHON_BIN" -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
pip install --upgrade pip wheel

# PyTorch with Metal (MPS) support. Stable wheels support MPS on macOS 14+.
# If a node complains about an MPS op, try the nightly instead:
#   pip install --pre torch torchvision torchaudio --extra-index-url https://download.pytorch.org/whl/nightly/cpu
pip install torch torchvision torchaudio
pip install -r requirements.txt

clone_node() {
  local repo="$1" dir="custom_nodes/$2"
  if [ ! -d "$dir/.git" ]; then
    git clone "$repo" "$dir"
  else
    git -C "$dir" pull --ff-only || true
  fi
  if [ -f "$dir/requirements.txt" ]; then
    pip install -r "$dir/requirements.txt" || echo "!! requirements for $2 failed (optional node, continuing)"
  fi
}

echo "==> Installing custom nodes"
clone_node https://github.com/Comfy-Org/ComfyUI-Manager ComfyUI-Manager
clone_node https://github.com/cubiq/ComfyUI_IPAdapter_plus ComfyUI_IPAdapter_plus
clone_node https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite ComfyUI-VideoHelperSuite
clone_node https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved ComfyUI-AnimateDiff-Evolved

# ffmpeg is needed by VideoHelperSuite to write mp4 files (video is optional).
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "!! ffmpeg not found. For video output run: brew install ffmpeg"
fi

mkdir -p models/checkpoints models/loras models/vae models/clip_vision models/ipadapter models/animatediff_models models/controlnet

cat <<MSG

Done. Next steps:
  1. Put a checkpoint into:   $COMFY_DIR/models/checkpoints   (see docs/MODELS.md)
  2. (optional) IP-Adapter weights: bash scripts/download-ipadapter.sh "$COMFY_DIR"
  3. Start everything:        bash scripts/start-all.sh "$COMFY_DIR"
MSG
