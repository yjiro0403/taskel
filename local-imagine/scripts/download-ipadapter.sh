#!/usr/bin/env bash
# Downloads the IP-Adapter weights ComfyUI_IPAdapter_plus needs for persona consistency.
# File names must match EXACTLY what the Unified Loader expects, so do not rename them.
#
#   bash scripts/download-ipadapter.sh [comfyui-dir] [sd15|sdxl|both]
set -euo pipefail
COMFY_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)/../ComfyUI}"
WHICH="${2:-both}"
CV="$COMFY_DIR/models/clip_vision"
IPA="$COMFY_DIR/models/ipadapter"
mkdir -p "$CV" "$IPA"

dl() { # url dest  (downloads to dest.part and renames, so an interrupted run never leaves a truncated file behind)
  if [ -f "$2" ]; then echo "exists: $2"; return; fi
  echo "fetch : $2"
  curl -L --fail --progress-bar -C - -o "$2.part" "$1"
  mv "$2.part" "$2"
}

# CLIP vision encoder used by all ViT-H presets (SD1.5 and SDXL "vit-h" adapters)
dl https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors \
   "$CV/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"

if [ "$WHICH" = "sd15" ] || [ "$WHICH" = "both" ]; then
  dl https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter_sd15.safetensors            "$IPA/ip-adapter_sd15.safetensors"
  dl https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus_sd15.safetensors       "$IPA/ip-adapter-plus_sd15.safetensors"
  dl https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus-face_sd15.safetensors  "$IPA/ip-adapter-plus-face_sd15.safetensors"
fi
if [ "$WHICH" = "sdxl" ] || [ "$WHICH" = "both" ]; then
  dl https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter_sdxl_vit-h.safetensors           "$IPA/ip-adapter_sdxl_vit-h.safetensors"
  dl https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors      "$IPA/ip-adapter-plus_sdxl_vit-h.safetensors"
  dl https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors "$IPA/ip-adapter-plus-face_sdxl_vit-h.safetensors"
fi
echo "Done. Restart ComfyUI so the new files show up (Local Imagine picks the preset automatically)."
