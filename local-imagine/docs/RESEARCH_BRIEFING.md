<!-- Generated 2026-11-02 by a web-research pass with adversarial verification of API-shape claims. English on purpose: most sources are English. Facts tagged [high]/[medium]/[low] confidence; "(corrected)" marks claims fixed by the verification pass. -->

# Engineering Briefing: Local "Grok Imagine"-style App on Apple Silicon (M1, 8–16 GB)

**Date:** 2026-11-02 · **Target:** Next.js 16 + TypeScript, local-only, Mac M1 · **Backends:** Ollama (LLM), ComfyUI (images, optional video), optional mflux/mfluxible and Draw Things
**Status key:** facts are tagged `[high]`, `[medium]`, `[low]` confidence as carried over from the research; where a verification pass refuted a claim, the corrected version is used and marked `(corrected)`.

---

## 1. Recommended architecture

### 1.1 Topology

```
Browser (http://localhost:3000)
   │  HTTP + SSE only (no CORS anywhere)
   ▼
Next.js 16.4.x  (App Router, Node 22 runtime route handlers, Turbopack)
   ├── /api/llm/*     ──► Ollama      http://127.0.0.1:11434   (native /api/chat, NDJSON)
   ├── /api/comfy/*   ──► ComfyUI     http://127.0.0.1:8188    (REST) + ws://127.0.0.1:8188/ws (relayed as SSE)
   ├── /api/media/*   ──► app-owned data dir (copied outputs, SQLite/JSON index per persona/chat)
   └── optional: LM Studio http://localhost:1234/v1, mfluxible http://127.0.0.1:8420, Draw Things http://127.0.0.1:7860
```

**Why all calls go through route handlers (not the browser):**
- ComfyUI without `--enable-cors-header` runs `create_origin_only_middleware`: requests with `Sec-Fetch-Site: cross-site` get 403, and when `Host` is loopback and the `Origin` hostname differs the server logs a warning and returns 403. Requests without an `Origin` header (Node `fetch`, curl) pass. `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/server.py
- Ollama already allows `http(s)://localhost`, `127.0.0.1`, `0.0.0.0` on any port by default (`AllowedOrigins` in envconfig), so browser-direct would work, but server-side keeps one streaming protocol and lets us orchestrate memory between LLM and image model. `[high]` https://raw.githubusercontent.com/ollama/ollama/main/envconfig/config.go
- LM Studio has CORS **off** by default (`lms server start --cors` or the "Enable CORS" switch); irrelevant when proxied. `[high]` https://github.com/lmstudio-ai/docs/blob/main/3_cli/1_serve/server-start.mdx

### 1.2 LLM backend: Ollama (primary), LM Studio (secondary provider)

- Ollama v0.40.13 (28 Oct 2026). Default bind `127.0.0.1:11434`; macOS app needs macOS Sonoma 14+, Apple M-series; models in `~/.ollama/models`, logs `~/.ollama/logs/server.log`, CLI linked into `/usr/local/bin`. `[high]` https://raw.githubusercontent.com/ollama/ollama/main/docs/macos.mdx , https://raw.githubusercontent.com/ollama/ollama/main/envconfig/config.go
- Use the **native** `/api/chat` (not `/v1`) because it exposes `think`, `options.num_ctx`, `keep_alive`, `format` (JSON schema), `images` (base64) — none of which the OpenAI-compatible route can pass (`num_ctx` only via a custom Modelfile; `tool_choice` unsupported). `[high]` https://raw.githubusercontent.com/ollama/ollama/main/docs/api/openai-compatibility.mdx
- MLX runtime (default since v0.40.0 for MLX-supported architectures: gemma4, qwen3.5, qwen3.6, embeddinggemma-2) is selected per model **by manifest format** (`IsMLX()` = `ModelFormat == "safetensors"`; GGUF → llama.cpp). (corrected) There is **no memory gate** in current source; the ">32 GB only" restriction appears only in secondary write-ups of the 0.19 preview launch. Real 8/16 GB MLX performance is **unverified**. `[high]` https://github.com/ollama/ollama/releases/tag/v0.40.0 , https://github.com/ollama/ollama/releases/tag/v0.19.0
- LM Studio: OpenAI-compatible server at `http://localhost:1234/v1` (`/v1/models`, `/v1/chat/completions`, `/v1/responses` since 0.3.29, `/v1/messages` Anthropic-compatible since 0.4.1); JIT loading on by default (idle TTL 60 min, per-request `"ttl"` seconds, Auto-Evict keeps max 1 JIT model). `/api/v0/models` reports `state` loaded/not-loaded, `type` llm|vlm|embeddings, `compatibility_type` gguf|mlx, `max_context_length`, and (corrected) the `capabilities` array (added 0.3.16 to `/api/v0`, not `/v1/models`). Docs now recommend `/api/v1` (0.4.0: model download/load/unload, stateful chats, API tokens) for new projects. `[high]` https://raw.githubusercontent.com/lmstudio-ai/docs/main/1_developer/api-changelog.md , https://github.com/lmstudio-ai/docs/blob/main/1_developer/2_rest/endpoints.mdx

**8 GB vs 16 GB justification (LLM):**
- Unified memory is shared by the LLM, ComfyUI and macOS. On 8 GB a 4B Q4 LLM (~3.4 GB + KV cache) cannot coexist with an SDXL pipeline; on 16 GB keep the LLM ≤ 9B Q4 (~6.6 GB) and unload it before image batches. `[medium]` (sizes are secondary; verify via `/api/tags` `size`)
- Default context is **4k** on Macs with <24 GiB (`OLLAMA_CONTEXT_LENGTH` "4k/32k/256k based on VRAM"); always set `options.num_ctx` explicitly (4096–8192 on 8 GB, 8192–16384 on 16 GB). `[high]` https://raw.githubusercontent.com/ollama/ollama/main/docs/context-length.mdx
- `OLLAMA_KEEP_ALIVE` default 5m; per-request `keep_alive: 0` unloads immediately (`done_reason: "unload"`). Use it before each ComfyUI batch on 8 GB. `OLLAMA_MAX_LOADED_MODELS` default 3×GPUs; set to 1. `OLLAMA_KV_CACHE_TYPE=q8_0` halves KV memory (needs flash attention, auto-enabled when supported). macOS app env vars: `launchctl setenv ... ` then restart Ollama.app (does not persist across reboots). `[high]` https://raw.githubusercontent.com/ollama/ollama/main/docs/faq.mdx

### 1.3 Image backend: ComfyUI (primary), mflux/mfluxible (optional 16 GB "modern model" tier), Draw Things (optional)

- ComfyUI 0.43.0 (`comfyui_version.py`, repo now github.com/Comfy-Org/ComfyUI; `comfyanonymous/ComfyUI` raw URLs still resolve). Classic API (`/prompt`, `/history`, `/view`, `/upload/image`, `/object_info`, `/ws`) is stable across 0.x; every route is also mirrored under `/api/`. `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfyui_version.py , https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/server.py
- **Apple Silicon behaviour (model_management.py)** `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy/model_management.py :
  - device = `mps`; `vram_state` forced to **SHARED** → `--lowvram/--novram/--highvram/--normalvram` are no-ops.
  - UNet defaults to **fp16** (`should_use_fp16` True on MPS); bf16 enabled only on macOS ≥ 14.
  - (corrected) The VAE does **not** stay fp32 by default: standard SD/SDXL VAE `working_dtypes` are `[bf16, fp32]`, so on macOS 14+ the VAE runs in **bf16**; on macOS < 14 it falls back to fp32. Pass `--fp32-vae` or `--fp16-vae` to override.
  - (corrected) The text encoder (CLIP) runs on **CPU** by default on MPS because `text_encoder_device()` only uses the GPU for HIGH_VRAM/NORMAL_VRAM states; `--gpu-only` moves it to MPS.
  - fp8: `supports_cast` returns False on MPS, `supports_fp8_compute` False off NVIDIA → **fp8 checkpoints do not load** (`TypeError: Trying to convert Float8_e4m3fn to the MPS backend`). `[high]` https://github.com/Comfy-Org/ComfyUI/issues/10292 , https://github.com/Comfy-Org/ComfyUI/issues/8988
  - Attention: PyTorch SDPA is not auto-enabled for MPS, so default is sub-quadratic ("Using sub quadratic optimization for attention..."). `--use-pytorch-cross-attention`, `--use-split-cross-attention`, `--use-quad-cross-attention` are mutually exclusive. `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy/ldm/modules/attention.py
  - `--aggressive-offload` for Apple Silicon (PR #13367) was closed unmerged 2026-05-12; no such flag. `[high]` https://github.com/Comfy-Org/ComfyUI/pull/13367
- **Install path A (manual, recommended for developers):** Python 3.10–3.12 venv, `pip install torch torchvision torchaudio` (Apple: stable PyTorch 2.11 supports MPS on macOS 14+), `git clone https://github.com/Comfy-Org/ComfyUI`, `pip install -r requirements.txt`. `[high]` https://developer.apple.com/metal/pytorch/ , https://github.com/comfyanonymous/ComfyUI/blob/master/README.md
- **Install path B (Comfy Desktop v1.x):** github.com/Comfy-Org/Comfy-Desktop (v1.1.8, 22 Oct 2026; macOS Apple Silicon .dmg). (corrected) README download link is `https://dl.todesktop.com/241130tqe9q3y`; installs under `~/ComfyUI-Installs` (documented in the Linux section; not explicitly stated for macOS), app data `~/Library/Application Support/Comfy Desktop`; Comfy-Org docs also mention a shared model library `~/ComfyUI-Shared` and macOS 13+ requirement. (corrected) Default port is **8188** (`extractPort(args, defaultPort = 8188)`); only adopted legacy v0.x installs get `--port 8000` synthesized. Launch: `<install>/standalone-env/bin/python3 -s ComfyUI/main.py <launchArgs>`, default launchArgs `--enable-manager`, editable with an `envVars` field. The archived v0.x Electron app (Comfy-Org/desktop, archived 2026-06-26, bundles ComfyUI 0.22.3) used port 8000. `[high]` https://github.com/Comfy-Org/Comfy-Desktop , https://raw.githubusercontent.com/Comfy-Org/Comfy-Desktop/main/src/main/lib/util.ts , https://raw.githubusercontent.com/Comfy-Org/Comfy-Desktop/main/docs/legacy-desktop-adopt-migration.md , https://github.com/Comfy-Org/desktop , https://raw.githubusercontent.com/Comfy-Org/docs/main/installation/desktop/macos.mdx
  → **App must probe 8188 first, then 8000**, via `GET /system_stats`, and show `comfyui_version`, device `type`, and `argv`.
- **Recommended launch line (M1 baseline):**
  ```bash
  python main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch --preview-method auto \
    --output-directory "$APP_DATA/comfy-output"
  ```
  Add only when needed: `--fp32-vae` or `--force-upcast-attention` (black/NaN images), `--fp16-vae` (if bf16 VAE decode is very slow; see §7), `--use-pytorch-cross-attention` (speed experiment) **or** `--use-split-cross-attention` (memory errors / bf16 black video), `--cache-none` / `--disable-smart-memory` (memory pressure), `--cpu-vae` (VAE OOM / MPS VAE corruption). Env: `PYTORCH_ENABLE_MPS_FALLBACK=1` (unsupported ops → CPU). `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy/cli_args.py
- **mflux (MLX-native, optional):** v0.24.0 (27 Oct 2026), org `mflux-community`, Python ≥ 3.11, `uv tool install --upgrade mflux`; FLUX.1 is "legacy"; focus is Z-Image, FLUX.2 Klein 4B/9B, Qwen-Image 2.1; `--quantize 3/4/5/6/8`, multi-LoRA `--lora-paths/--lora-scales`, `--low-ram`, `--compute-precision float16` ("GPUs without native bfloat16, the Apple M1 family"). No HTTP server in core; community `mfluxible` (`pip install mfluxible`, `mfluxible-server` on 127.0.0.1:8420) exposes streaming + OpenAI-compatible image endpoints (loads one model at startup, `MFLUXIBLE_MODEL`, `MFLUXIBLE_QUANTIZE=4`). `[high]` https://raw.githubusercontent.com/mflux-community/mflux/main/pyproject.toml , https://raw.githubusercontent.com/mflux-community/mflux/main/src/mflux/models/common/README.md , https://github.com/wesbiggs/mfluxible
- **Draw Things (optional):** WebUI-compatible HTTP API on 127.0.0.1:7860 (`POST /sdapi/v1/txt2img` → `{"images":[base64...]}`), gRPC on 7859 (TLS). Reports put it ~3× faster than ComfyUI for SDXL on the same Mac `[medium]`. `[high]` https://github.com/drawthingsai/draw-things-community/issues/127 , https://github.com/drawthingsai/draw-things-community

**8 GB vs 16 GB justification (images):**

| RAM | Tier | Why |
|---|---|---|
| **8 GB** | SD1.5 only, 512×768, DPM++ 2M Karras 20 steps, CFG 7, clip-skip 2 for anime | ComfyUI's "VRAM" is system RAM; ~5–6 GB usable. SD1.5 512px reports: ~15–70 s/image `[low]`. SDXL/Flux/Z-Image hidden. Unload the LLM (`keep_alive: 0`) before each batch. https://www.serverman.co.uk/ai/comfyui/how-to-install-comfyui-mac/ |
| **16 GB** | SDXL fp16 (Illustrious/NoobAI/Pony/Juggernaut) + SDXL-Lightning/Hyper-SD LoRA as default "fast" mode (4–8 steps, CFG ~1); Z-Image Turbo bf16 as "slow"; FLUX.2 Klein 4B / Z-Image via mflux optional | SDXL 1024px ≈ 60–110 s per 20–30-step image on M1/M2-class 16 GB `[low]`; Lightning cuts to a fraction. Z-Image Turbo "fits within 16GB" per ComfyUI docs; Mac reports 90–160 s/image `[medium]`. FLUX.1 dev unquantized swaps (175 s for 2 steps + 22 GB swap on M1 Pro 16 GB). https://raw.githubusercontent.com/Comfy-Org/docs/main/tutorials/image/z-image/z-image-turbo.mdx , https://github.com/mflux-community/mflux/issues/7 |

### 1.4 Video backend: ComfyUI AnimateDiff (experimental, 16 GB only) — see §5

---

## 2. Exact API contracts

### 2.1 ComfyUI REST (base `http://127.0.0.1:8188`, all also under `/api/`)

Source for everything in this subsection unless noted: `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/server.py

**POST /prompt**
```jsonc
// request
{
  "prompt": { /* API-format graph, see 2.3 */ },
  "client_id": "6c1a0b2e-…",          // MUST match ws clientId, MUST be sent (see 2.2)
  "prompt_id": "0f3d5c1a-7b2e-4c9f-9a1b-2d3e4f5a6b7c", // optional; canonical lowercase hyphenated UUID or 400 invalid_prompt_id
  "number": 0,                        // optional queue priority
  "front": false,                     // optional; only applies when number absent
  "extra_data": {},                   // optional
  "partial_execution_targets": null,  // optional
  "workflow_metadata": {}             // optional, validated, stored in extra_data
}
// 200
{ "prompt_id": "0f3d5c1a-…", "number": 12, "node_errors": {} }
// 400 (validation)
{ "error": { "type": "prompt_outputs_failed_validation", "message": "...", "details": "...", "extra_info": {} },
  "node_errors": { "3": { "errors": [ { "type": "value_not_in_list", "message": "...", "details": "ckpt_name: 'x' not in [...]", "extra_info": {"input_name":"ckpt_name"} } ], "dependent_outputs": ["9"], "class_type": "CheckpointLoaderSimple" } } }
// 400 (no prompt)      { "error": { "type": "no_prompt", ... }, "node_errors": {} }
// 400 (bad prompt_id)  { "error": { "type": "invalid_prompt_id", ... }, "node_errors": {} }
```

**GET /history/{prompt_id}** (also `GET /history?max_items=&offset=`)
```jsonc
{
  "0f3d5c1a-…": {
    "prompt": [12, "0f3d5c1a-…", { /* graph */ }, { "client_id": "…" }, ["9"]],
    "outputs": {
      "9": { "images": [ { "filename": "persona_00001_.png", "subfolder": "", "type": "output" } ] }
    },
    "status": { "status_str": "success", "completed": true, "messages": [["execution_start", {...}], ["execution_cached", {...}], ["execution_success", {...}]] },
    "meta": { "9": { "node_id": "9", "display_node": "9", "parent_node": null, "real_node_id": "9" } }
  }
}
```
`status` can be null for entries written without a status; check `status.status_str` before assuming images exist. `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/execution.py

**GET /view**
```
GET /view?filename=persona_00001_.png&subfolder=&type=output
GET /view?filename=…&type=output&preview=webp;80          # transcoded thumbnail (webp|jpeg only; others → webp; default quality 90)
GET /view?filename=…&type=output&channel=rgba             # rgba|rgb|a (a forces webp)
```
`type` ∈ output|temp|input (default output). 400 bad filename, 403 if subfolder escapes base dir, 404 missing. `X-Content-Type-Options: nosniff` on the plain-file branch only.

**POST /upload/image** (multipart/form-data)
```
fields: image=<file> (required; empty filename → 400), overwrite="true"|"1", type=input|temp|output (default input), subfolder=
```
```jsonc
// 200 (corrected: preview_url/preview_id live INSIDE the optional asset object)
{ "name": "ref_01.png", "subfolder": "", "type": "input",
  "asset": { "id": "…", "preview_url": "…", "preview_id": "…" } /* only when asset manager registers it */ }
```
Duplicate content (hash) is not re-saved; same name + different content → `"name (1).png"` unless `overwrite`. Always feed `response.name` (with subfolder prefix if any) into `LoadImage.inputs.image`. `POST /upload/mask` is the same handler with an `original_ref` JSON field.

**GET /object_info** / **GET /object_info/{class}**
```jsonc
// GET /object_info/CheckpointLoaderSimple
{ "CheckpointLoaderSimple": {
    "input": { "required": { "ckpt_name": [ ["sdxl/juggernautXL_v9.safetensors", "sd15/realisticVision_v60.safetensors"], { "tooltip": "..." } ] } },
    "input_order": { "required": ["ckpt_name"] },
    "output": ["MODEL","CLIP","VAE"], "output_is_list": [false,false,false], "output_name": ["MODEL","CLIP","VAE"],
    "name": "CheckpointLoaderSimple", "display_name": "Load Checkpoint", "description": "...", "python_module": "nodes",
    "category": "loaders", "output_node": false } }
```
Pickers: checkpoints `/object_info/CheckpointLoaderSimple → .input.required.ckpt_name[0]`; LoRAs `/object_info/LoraLoader → .input.required.lora_name[0]`; samplers/schedulers `/object_info/KSampler`. Names are relative to the model folder and may contain subfolders — pass verbatim. Also `GET /models/{folder}` (e.g. `/models/checkpoints`, `/models/loras`). `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/nodes.py , https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/folder_paths.py

**Queue / interrupt / stats / free**
```jsonc
GET  /queue   → { "queue_running": [[number, prompt_id, prompt, extra_data, outputs_to_execute]], "queue_pending": [[...]] }  // 5-element arrays (6th 'sensitive' element stripped)
POST /queue   { "clear": true }  |  { "delete": ["<prompt_id>"] }        → 200 empty
GET  /prompt  → { "exec_info": { "queue_remaining": 2 } }
POST /interrupt  { "prompt_id": "…" }   // only interrupts if that prompt is running; no/invalid body → global interrupt; 200 empty
POST /history { "clear": true } | { "delete": ["…"] }
POST /free    { "unload_models": true, "free_memory": true }
GET  /system_stats →
{ "system": { "os": "posix", "ram_total": 17179869184, "ram_free": 6100000000, "comfyui_version": "0.43.0",
              "required_frontend_version": "…", "python_version": "3.12.x", "pytorch_version": "2.11.0",
              "embedded_python": false, "argv": ["main.py","--listen","127.0.0.1","--port","8188"],
              "comfy_package_versions": {...}, "installed_templates_version": "…", "required_templates_version": "…", "deploy_environment": "…" },
  "devices": [ { "name": "mps", "type": "mps", "index": 0, "vram_total": 17179869184, "vram_free": 6100000000,
                 "torch_vram_total": 17179869184, "torch_vram_free": 6100000000 } ] }
```
On MPS `vram_total/free` are system RAM (`get_total_memory` treats `mps` like `cpu`). Newer jobs routes exist only as `/api/jobs`, `/api/jobs/{job_id}`, `POST /api/jobs/{job_id}/cancel`, `POST /api/jobs/cancel {"job_ids":[...]}` → `{"cancelled": bool}` — treat as optional (legacy Desktop bundles 0.22.3).

### 2.2 ComfyUI WebSocket

```
ws://127.0.0.1:8188/ws?clientId=<same uuid as POST /prompt client_id>
```
Open the socket **before** POSTing `/prompt`. On connect the server sends:
```jsonc
{ "type": "status", "data": { "status": { "exec_info": { "queue_remaining": 0 } }, "sid": "<clientId>" } }
// plus, if a node is executing for this client:
{ "type": "executing", "data": { "node": "3" } }
```
Optional first client message negotiates features: `{ "type": "feature_flags", "data": { "supports_preview_metadata": true } }` (server replies with its own `feature_flags`).

**Text events** (`{type, data}`; `timestamp` in ms added by `add_message`) `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/main.py , https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy_execution/progress.py
```jsonc
{ "type": "execution_start",   "data": { "prompt_id": "…", "timestamp": 1762000000000 } }
{ "type": "execution_cached",  "data": { "nodes": ["4","6","7"], "prompt_id": "…", "timestamp": … } }
{ "type": "executing",         "data": { "node": "3", "display_node": "3", "prompt_id": "…" } }
{ "type": "progress",          "data": { "value": 7, "max": 20, "prompt_id": "…", "node": "3" } }
{ "type": "progress_state",    "data": { "prompt_id": "…", "nodes": { "3": { "value": 7, "max": 20, "state": "running", "node_id": "3", "prompt_id": "…", "display_node_id": "3", "parent_node_id": null, "real_node_id": "3" } } } }
{ "type": "executed",          "data": { "node": "9", "display_node": "9", "output": { "images": [ { "filename": "…", "subfolder": "", "type": "output" } ] }, "prompt_id": "…" } }
{ "type": "execution_success", "data": { "prompt_id": "…", "timestamp": … } }
{ "type": "execution_error",   "data": { "prompt_id": "…", "node_id": "3", "node_type": "KSampler", "executed": ["4","6","7","5"], "exception_message": "…", "exception_type": "RuntimeError", "traceback": ["…"], "current_inputs": {...}, "current_outputs": {...}, "timestamp": … } }
{ "type": "execution_interrupted", "data": { "prompt_id": "…", "node_id": "3", "node_type": "KSampler", "executed": [...], "timestamp": … } }  // always broadcast
{ "type": "executing",         "data": { "node": null, "prompt_id": "…" } }   // COMPLETION sentinel, sent after history is written
```
**(corrected) client_id gating:** per-node `executing`/`executed` go to `server.client_id` and are **broadcast to all sockets when no client_id was sent**. `execution_start/cached/success/error` use `broadcast=False` and are **not sent at all** when `client_id` is None. The final `executing {node:null}` is sent only `if server_instance.client_id is not None`. → **Always send `client_id`**, otherwise the completion sentinel never arrives.

**Binary frames** (`[4-byte BE event id][payload]`) `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/protocol.py
```
event 1 PREVIEW_IMAGE:               [u32 BE = 1][u32 BE image type: 1=JPEG, 2=PNG][image bytes]
event 3 TEXT:                        [u32 BE = 3][u32 BE node_id length][node_id][text]
event 4 PREVIEW_IMAGE_WITH_METADATA: [u32 BE = 4][u32 BE metadata length][JSON {node_id, prompt_id, image_type/mimetype,...}][image bytes]
(event 2 UNENCODED_PREVIEW_IMAGE is internal; converted to type 1 before sending)
```
Previews only appear with `--preview-method auto|taesd|latent2rgb` (default `none`).

**Completion rule:** terminal = `executing{node:null, prompt_id===mine}` **or** `execution_error` **or** `execution_interrupted`. Then `GET /history/{prompt_id}` → iterate `outputs[*].images[]` (and `gifs[]` for VHS, §5) → `/view`. Official reference: `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/script_examples/websockets_api_example.py

### 2.3 ComfyUI API-format graphs (node schemas from nodes.py `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/nodes.py)

Node schema reference: `CheckpointLoaderSimple{ckpt_name}→MODEL,CLIP,VAE` · `CLIPTextEncode{text, clip}→CONDITIONING` · `EmptyLatentImage{width, height (INT default **1024**, 16..16384 step 8), batch_size 1..4096}→LATENT` · `KSampler{model, seed 0..0xffffffffffffffff, steps 20 (1..10000), cfg 8.0 (0..100 step 0.1), sampler_name, scheduler, positive, negative, latent_image, denoise 1.0}→LATENT` · `VAEDecode{samples, vae}→IMAGE` · `VAEEncode{pixels, vae}→LATENT` · `SaveImage{images, filename_prefix "ComfyUI"}` (output node, returns `{"ui":{"images":[...]}}`) · `PreviewImage{images}` (type temp) · `LoadImage{image, image_upload:true}→IMAGE,MASK` · `LoraLoader{model, clip, lora_name, strength_model 1.0 (-100..100), strength_clip 1.0}→MODEL,CLIP` · `LoraLoaderModelOnly{model, lora_name, strength_model}→MODEL` · `CLIPSetLastLayer{clip, stop_at_clip_layer}` (clip skip 2 = -2).

Samplers (`KSampler.SAMPLERS`): euler, euler_cfg_pp, euler_ancestral, euler_ancestral_cfg_pp, heun, heunpp2, dpm_2, dpm_2_ancestral, lms, dpm_fast, dpm_adaptive, dpmpp_2s_ancestral, dpmpp_sde, dpmpp_sde_gpu, dpmpp_2m, dpmpp_2m_cfg_pp, dpmpp_2m_sde, dpmpp_2m_sde_gpu, dpmpp_3m_sde, dpmpp_3m_sde_gpu, ddpm, lcm, ipndm, ipndm_v, deis, res_multistep, gradient_estimation, er_sde, seeds_2, seeds_3, sa_solver, sa_solver_pece, … + ddim, uni_pc, uni_pc_bh2. Schedulers: simple, sgm_uniform, karras, exponential, ddim_uniform, beta, normal, linear_quadratic, kl_optimal. Populate from `/object_info/KSampler`, don't hardcode. `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy/samplers.py

**txt2img (SD1.5/SDXL single-file checkpoint, optional LoRA + clip skip)**
```jsonc
{
  "4":  { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "sdxl/illustriousXL_v20.safetensors" } },
  "10": { "class_type": "LoraLoader", "inputs": { "model": ["4",0], "clip": ["4",1], "lora_name": "sdxl_lightning_8step_lora.safetensors", "strength_model": 1.0, "strength_clip": 1.0 } },
  "11": { "class_type": "CLIPSetLastLayer", "inputs": { "clip": ["10",1], "stop_at_clip_layer": -2 } },   // Pony/anime only
  "6":  { "class_type": "CLIPTextEncode", "inputs": { "text": "1girl, …", "clip": ["11",0] } },
  "7":  { "class_type": "CLIPTextEncode", "inputs": { "text": "lowres, bad anatomy, …", "clip": ["11",0] } },
  "5":  { "class_type": "EmptyLatentImage", "inputs": { "width": 832, "height": 1216, "batch_size": 1 } },  // ALWAYS explicit; 512x768 for SD1.5
  "3":  { "class_type": "KSampler", "inputs": { "model": ["10",0], "positive": ["6",0], "negative": ["7",0], "latent_image": ["5",0],
          "seed": 123456789, "steps": 8, "cfg": 1.0, "sampler_name": "euler", "scheduler": "sgm_uniform", "denoise": 1.0 } },
  "8":  { "class_type": "VAEDecode", "inputs": { "samples": ["3",0], "vae": ["4",2] } },
  "9":  { "class_type": "SaveImage", "inputs": { "images": ["8",0], "filename_prefix": "persona_<id>/img" } }
}
```
"Several images per request" = N queued prompts with different seeds (preferred on M1: progress per image, constant memory) rather than `batch_size > 1`.

**img2img / reference-image variation**
```jsonc
"20": { "class_type": "LoadImage", "inputs": { "image": "ref_01.png" } },        // name from /upload/image
"21": { "class_type": "VAEEncode", "inputs": { "pixels": ["20",0], "vae": ["4",2] } },
"3":  { "class_type": "KSampler", "inputs": { "...": "...", "latent_image": ["21",0], "denoise": 0.6 } }   // 0.5–0.75
```

**IP-Adapter persona (ComfyUI_IPAdapter_plus)** `[high]` https://raw.githubusercontent.com/cubiq/ComfyUI_IPAdapter_plus/main/IPAdapterPlus.py
```jsonc
"30": { "class_type": "IPAdapterUnifiedLoader", "inputs": { "model": ["4",0], "preset": "PLUS FACE (portraits)" } },  // read exact preset strings from /object_info/IPAdapterUnifiedLoader
"31": { "class_type": "IPAdapterAdvanced", "inputs": { "model": ["30",0], "ipadapter": ["30",1], "image": ["20",0],
        "weight": 0.8, "weight_type": "linear", "combine_embeds": "average", "start_at": 0.0, "end_at": 0.9, "embeds_scaling": "V only" } },
"3":  { "class_type": "KSampler", "inputs": { "model": ["31",0], "...": "..." } }
```
Presets: LIGHT (SD1.5 only), STANDARD, VIT-G, PLUS, PLUS FACE, FULL FACE (SD1.5 only); FaceID loader: FACEID, FACEID PLUS (SD1.5), FACEID PLUS V2, FACEID PORTRAIT, FACEID PORTRAIT UNNORM (SDXL); insightface provider options CPU/CUDA/ROCM/DirectML/OpenVINO/CoreML → use `CPU` or `CoreML` on Mac. Verify exact preset enum strings via `/object_info` (the research lists display names, not necessarily the exact widget values).

**ControlNet OpenPose** `[high]` https://github.com/Comfy-Org/docs/blob/main/tutorials/controlnet/pose-controlnet-2-pass.mdx
```jsonc
"40": { "class_type": "ControlNetLoader", "inputs": { "control_net_name": "control_v11p_sd15_openpose_fp16.safetensors" } },
"41": { "class_type": "DWPreprocessor", "inputs": { "image": ["20",0], "detect_hand": "enable", "detect_body": "enable", "detect_face": "enable", "resolution": 512, "bbox_detector": "yolox_l.torchscript.pt", "pose_estimator": "dw-ll_ucoco_384_bs5.torchscript.pt" } }, // comfyui_controlnet_aux; verify widget names via /object_info
"42": { "class_type": "ControlNetApplyAdvanced", "inputs": { "positive": ["6",0], "negative": ["7",0], "control_net": ["40",0], "image": ["41",0], "strength": 0.8, "start_percent": 0.0, "end_percent": 0.7 } },
"3":  { "class_type": "KSampler", "inputs": { "positive": ["42",0], "negative": ["42",1], "...": "..." } }
```

**Flux Kontext dev (GGUF, 16 GB opt-in)** `[high]` https://github.com/comfyanonymous/ComfyUI/blob/master/comfy_extras/nodes_edit_model.py , https://github.com/city96/ComfyUI-GGUF
```jsonc
"50": { "class_type": "UnetLoaderGGUF", "inputs": { "unet_name": "flux1-kontext-dev-Q4_K_M.gguf" } },
"51": { "class_type": "DualCLIPLoader", "inputs": { "clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux" } }, // fp8 T5 is upcast on MPS; prefer GGUF T5 via DualCLIPLoaderGGUF
"52": { "class_type": "VAELoader", "inputs": { "vae_name": "ae.safetensors" } },
"53": { "class_type": "LoadImage", "inputs": { "image": "ref_01.png" } },
"54": { "class_type": "FluxKontextImageScale", "inputs": { "image": ["53",0] } },
"55": { "class_type": "VAEEncode", "inputs": { "pixels": ["54",0], "vae": ["52",0] } },
"56": { "class_type": "CLIPTextEncode", "inputs": { "text": "same woman, now wearing a red kimono, standing in a garden", "clip": ["51",0] } },
"57": { "class_type": "ReferenceLatent", "inputs": { "conditioning": ["56",0], "latent": ["55",0] } },   // chain more for multiple refs, or ImageStitch first
"58": { "class_type": "FluxGuidance", "inputs": { "conditioning": ["57",0], "guidance": 2.5 } },
"59": { "class_type": "EmptySD3LatentImage", "inputs": { "width": 768, "height": 768, "batch_size": 1 } },
"60": { "class_type": "KSampler", "inputs": { "model": ["50",0], "positive": ["58",0], "negative": ["56",0], "latent_image": ["59",0], "seed": 1, "steps": 20, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0 } },
"61": { "class_type": "VAEDecode", "inputs": { "samples": ["60",0], "vae": ["52",0] } },
"62": { "class_type": "SaveImage", "inputs": { "images": ["61",0], "filename_prefix": "kontext" } }
```

### 2.4 Ollama REST (base `http://127.0.0.1:11434`)

Source: `[high]` https://raw.githubusercontent.com/ollama/ollama/main/docs/api.md , https://raw.githubusercontent.com/ollama/ollama/main/api/types.go

**GET /api/tags**
```jsonc
{ "models": [ { "name": "qwen3.5:4b", "model": "qwen3.5:4b", "modified_at": "2026-10-30T12:00:00Z", "size": 3400000000,
    "digest": "sha256…", "details": { "parent_model": "", "format": "gguf", "family": "qwen3", "families": ["qwen3"], "parameter_size": "4B", "quantization_level": "Q4_K_M" },
    "capabilities": ["completion","vision","tools","thinking"] /* optional; ListModelResponse has it */, "remote_model": "", "remote_host": "" } ] }
```

**POST /api/show**
```jsonc
// request
{ "model": "qwen3.5:4b", "verbose": false }
// response (subset)
{ "modelfile": "…", "parameters": "…", "template": "…", "license": "…", "system": "…",
  "details": { "family": "qwen3", "parameter_size": "4B", "quantization_level": "Q4_K_M", ... },
  "model_info": { "general.architecture": "qwen3", "general.parameter_count": 4000000000, "qwen3.context_length": 262144, ... },
  "capabilities": ["completion", "vision", "tools", "thinking"],
  "thinking": { "values": [true, false], "default": true },      // values [false] = no thinking; missing object = no metadata
  "renderer": "…", "parser": "…", "template_source": "…", "requires": "…", "projector_info": {...} }
```

**POST /api/chat (streaming NDJSON, `Content-Type: application/x-ndjson`)**
```jsonc
// request
{
  "model": "qwen3.5:9b",
  "messages": [
    { "role": "system", "content": "You are an image-direction agent for persona 'Aoi'. …" },
    { "role": "user", "content": "Make her sit by a window in a school uniform", "images": ["<base64 without data: prefix>"] }
  ],
  "tools": [ { "type": "function", "function": { "name": "generate_images", "description": "Queue image generations for the active persona",
      "parameters": { "type": "object", "required": ["jobs"], "properties": { "jobs": { "type": "array", "items": { "type": "object",
        "required": ["prompt","negative_prompt"], "properties": { "prompt": {"type":"string"}, "negative_prompt": {"type":"string"},
        "width": {"type":"integer"}, "height": {"type":"integer"}, "seed": {"type":"integer"} } } }, "reply": {"type":"string"} } } } } ],
  "think": false,
  "format": null,                           // or "json" or a JSON-schema object (see below)
  "options": { "temperature": 0.7, "num_ctx": 8192, "num_predict": 1024, "seed": 42, "top_p": 0.9 },
  "stream": true,
  "keep_alive": "10m"                       // 0 → unload immediately
}
// chunk (content)
{ "model": "qwen3.5:9b", "created_at": "…", "message": { "role": "assistant", "content": "Sure" }, "done": false }
// chunk (thinking, when think:true)
{ "model": "…", "created_at": "…", "message": { "role": "assistant", "content": "", "thinking": "The user wants…" }, "done": false }
// chunk (tool call)  (corrected: native responses DO carry a server-generated id "call_xxxxxxxx"; no "type" field; treat id as optional)
{ "model": "…", "created_at": "…", "message": { "role": "assistant", "content": "",
    "tool_calls": [ { "id": "call_a1b2c3d4", "function": { "index": 0, "name": "generate_images", "arguments": { "jobs": [ { "prompt": "…", "negative_prompt": "…" } ] } } } ] }, "done": false }
// final chunk
{ "model": "…", "created_at": "…", "message": { "role": "assistant", "content": "" }, "done": true, "done_reason": "stop",
  "total_duration": 5200000000, "load_duration": 300000000, "prompt_eval_count": 412, "prompt_eval_duration": 900000000,
  "eval_count": 180, "eval_duration": 3900000000, "prompt_eval_cached_count": 300 }
// mid-stream error line
{ "error": "…" }
// tool result to send back (append the assistant message with its tool_calls first)
{ "role": "tool", "tool_name": "generate_images", "tool_call_id": "call_a1b2c3d4", "content": "{\"queued\":[\"<prompt_id>\",\"<prompt_id>\"]}" }
```
Tool-call `arguments` is a JSON **object**, not a string. Tool calls may arrive across chunks; accumulate. Agent loop = repeat chat until no `tool_calls`. `[high]` https://raw.githubusercontent.com/ollama/ollama/main/docs/capabilities/tool-calling.mdx

**Structured output (`format` = JSON schema)** — recommended for small models instead of free-form tools:
```jsonc
"format": { "type": "object", "required": ["reply","images"], "properties": {
   "reply": { "type": "string" },
   "images": { "type": "array", "items": { "type": "object", "required": ["prompt","negative_prompt"],
     "properties": { "prompt": {"type":"string"}, "negative_prompt": {"type":"string"}, "width": {"type":"integer"}, "height": {"type":"integer"}, "seed": {"type":"integer"} } } } } },
"options": { "temperature": 0 }
```
Result is a JSON string in `message.content`; docs recommend also putting the schema in the prompt and temperature 0. Zod 4: `z.toJSONSchema(Schema)`. `[high]` https://raw.githubusercontent.com/ollama/ollama/main/docs/capabilities/structured-outputs.mdx

**think**: `true | false | null | "low"|"medium"|"high"|"max"`; numbers not supported; reasoning streams in `message.thinking` before `content`. `[high]` https://raw.githubusercontent.com/ollama/ollama/main/docs/capabilities/thinking.mdx

**POST /api/pull (streaming)**
```jsonc
// request  { "model": "huihui_ai/qwen3-vl-abliterated:8b", "stream": true }
{ "status": "pulling manifest" }
{ "status": "pulling 8f2c…", "digest": "sha256:8f2c…", "total": 6200000000 }               // completed may be absent until bytes arrive
{ "status": "pulling 8f2c…", "digest": "sha256:8f2c…", "total": 6200000000, "completed": 1234567 }
{ "status": "verifying sha256 digest" } { "status": "writing manifest" } { "status": "removing any unused layers" } { "status": "success" }
```
**GET /api/ps** → `{ "models": [ { "name": "…", "model": "…", "size": …, "digest": "…", "details": {...}, "expires_at": "…", "size_vram": … } ] }` · **DELETE /api/delete** `{ "model": "…" }` · **GET /api/version**.

**OpenAI-compatible (`/v1`)**: `/v1/chat/completions` (streaming, tools, response_format, base64 vision, reasoning_effort, stream_options.include_usage), `/v1/completions`, `/v1/models`, `/v1/embeddings`, `/v1/responses` (non-stateful), also `/v1/messages` (Anthropic-compatible), `/v1/audio/*`. Unsupported: `tool_choice`, logprobs, logit_bias, `n`, image URLs. API key required by clients but ignored (use `"ollama"`). `[high]` https://raw.githubusercontent.com/ollama/ollama/main/docs/api/openai-compatibility.mdx

**LM Studio provider shape** (`http://localhost:1234/v1`): `GET /v1/models` (ids like `qwen/qwen3-vl-8b`; with JIT on lists all downloaded models), `POST /v1/chat/completions` (+ `"ttl": 300`), `GET /api/v0/models` → `{ id, object, type: "llm"|"vlm"|"embeddings", publisher, arch, compatibility_type: "gguf"|"mlx", quantization, state: "loaded"|"not-loaded", max_context_length, capabilities: ["tool_use"] }`. `[high]` https://github.com/lmstudio-ai/docs/blob/main/1_developer/2_rest/endpoints.mdx

---

## 3. Model recommendations

Sizes marked † come from search snippets of ollama.com/HF (unreachable this session) — display `size` from `/api/tags` in the UI rather than hardcoding. M1 speeds are community numbers `[low–medium]`.

### 3.1 Local LLMs (Ollama)

| Model | Family | RAM need (Q4) | Speed on M1 | Prompt style / role | NSFW suitability | Source |
|---|---|---|---|---|---|---|
| `qwen3.5:4b` | Qwen3.5 (vision+tools+thinking) | ~3.4 GB† — **8 GB default** | ~6–7 tok/s on M1 8 GB `[medium]` | Chat agent; `think:false`; `format` JSON schema preferred over tools | Official safety-tuned; refuses explicit | `ollama pull qwen3.5:4b` https://github.com/ollama/ollama/releases/tag/v0.40.0 |
| `qwen3.5:9b` | Qwen3.5 | ~6.6 GB† — **16 GB default** | 14.2 tok/s on M1 Pro `[medium]`; unresponsive on 8 GB | Same | Same | ollama.com (snippet) |
| `qwen3.5:2b` | Qwen3.5 | ~2.7 GB† | faster | Speed option on 8 GB | Same | ollama.com (snippet) |
| `qwen3-vl:4b` / `:8b` | Qwen3-VL (vision, tools, thinking; Ollama ≥ 0.12.7) | 3.3 GB / 6.1 GB (instruct, on disk) | n/a | Reference-image describer, OCR (32 langs); `-thinking` builds ~5× slower than `-instruct` | Official | https://github.com/ollama/ollama/releases/tag/v0.12.7 , https://github.com/QwenLM/Qwen3-VL , PhotoPrism table https://docs.photoprism.app/developer-guide/vision/model-comparison/ |
| `gemma4:e2b` / `:e4b` | Gemma 4 (text+image+audio, 140+ langs, tools; Ollama ≥ 0.20.0, tool fix 0.20.1 (corrected)) | 7.2 GB / 9.6 GB on disk (PhotoPrism) — heavy | "too heavy" on 8 GB `[medium]` | Fast captioner (208 image tokens/720px vs 1,182 for qwen3-vl) but systematically mislabels (corrected) | Strong safety training — not for NSFW prompt writing | https://github.com/ollama/ollama/releases/tag/v0.20.1 , https://raw.githubusercontent.com/ollama/ollama/main/docs/capabilities/vision.mdx |
| `huihui_ai/qwen3-vl-abliterated:4b` / `:8b` | Qwen3-VL, refusal-removed (community) | ≈ qwen3-vl | ≈ qwen3-vl | **NSFW agent + vision** in one model; may be less reliable at tools | Uncensored | `ollama pull huihui_ai/qwen3-vl-abliterated:8b` https://ollama.com/huihui_ai/qwen3-vl-abliterated `[medium]`, verify live tags |
| `huihui_ai/gemma-4-abliterated:e2b|e4b|12b…` | Gemma 4 abliterated | ≈ gemma4 | — | NSFW alternative with vision/audio | Uncensored | ollama.com/huihui_ai (snippet) `[medium]` |
| `huihui_ai/qwen3-abliterated:8b` | Qwen3 abliterated (text) | ~5 GB | — | NSFW text-only agent | Uncensored | ollama.com (unverified tags) |
| `minicpm-v4.6:1b` | MiniCPM-V | 1.6 GB | fastest labeler (PhotoPrism) | Ultra-light describer | Official | PhotoPrism table |
| `gpt-oss:20b` | OpenAI gpt-oss (MXFP4, 3.6B active) | ≈14 GB† — **do not recommend on 16 GB** | marginal/very slow `[low]` | Tools, structured outputs, reasoning low/medium/high | Safety-tuned | https://github.com/openai/gpt-oss |
| `llama3.2-vision`, `llava`, `moondream` | legacy | — | — | **Do not use**: llama3.2-vision fails with "unknown model architecture: 'mllama'" since Ollama 0.30.x (issue #16490, unresolved) | — | https://github.com/ollama/ollama/issues/16490 |

Picker logic: list `/api/tags`, call `/api/show` → require `capabilities ⊇ {"tools"}` for agent mode, `{"vision"}` for reference images; read `thinking.values` to show a toggle; cap `num_ctx` by `model_info.<arch>.context_length`.

### 3.2 Image models (ComfyUI unless noted)

| Model | Family | RAM need | Speed on M1 | Prompt style (agent profile) | NSFW | Source / folder |
|---|---|---|---|---|---|---|
| Realistic Vision V6.0 B1 | SD1.5 photoreal | **8 GB OK** | ~15–70 s @512px `[low]` | Natural language + long negative; DPM++ SDE Karras 25+ (or 2M Karras 20), CFG 7; 512×768 | Yes (checkpoint-dependent) | civitai.red / HF `SG161222/Realistic_Vision_V6.0_B1_noVAE` → `models/checkpoints` `[low]` |
| Counterfeit-V3 / Anything-V5 | SD1.5 anime | 8 GB OK | same | Danbooru tags; DPM++ 2M Karras 20, CFG 7, clip-skip 2, EasyNegative (`models/embeddings`) | Yes | civitai.red `[low]` |
| Pony Diffusion V6 XL | SDXL (stylised/furry/anime) | 16 GB | 60–110 s @1024 (20–30 steps) `[low]`; Lightning LoRA cuts ~4–6× | **Prefix** `score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up,` + `source_anime/…`, `rating_safe/questionable/explicit`, then tags; **clip-skip 2 required**; Euler a 25, CFG 7; 1024², 832×1216 | Yes (`rating_explicit`) | https://huggingface.co/AKEOR/Pony_Diffusion_V6_XL `[medium]` |
| Illustrious XL (v0.1/v2.0) | SDXL anime | 16 GB | same | Danbooru tags (v2 accepts hybrid NL); Euler a 20–28, CFG 4.5–7.5; up to 1536px | Yes | https://tensor.art/articles/798120703305104719 `[low]` |
| NoobAI-XL 1.0 (eps / v-pred) | SDXL anime (Danbooru+e621) | 16 GB | same | Tag order: count → character → series → artist → special → general; quality `masterpiece, best quality, newest, absurdres, highres`; `year 2021`; Euler a 25–30, CFG 5–6. **v-pred: no Karras**, CFG 3.5–5, needs `ModelSamplingDiscrete(v_prediction)` | Yes | https://huggingface.co/Laxhar/noobai-XL-1.0 `[medium]` |
| Animagine XL 4.0 | SDXL anime | 16 GB | same | `1girl, character, series, [rating], tags, masterpiece, high score, great score, absurdres`; `year 2025`; Euler a 25–28, CFG 5–7; negative starts `lowres, bad anatomy, … low score, bad score` | Yes | https://huggingface.co/cagliostrolab/animagine-xl-4.0 `[medium]` |
| Juggernaut XL (+ Lightning) | SDXL photoreal | 16 GB | same; Lightning: DPM++ SDE Karras 4–7 steps CFG 1–2 | Natural-language, photographic terms; DPM++ 2M Karras 30–40, CFG 4–7; 832×1216 | Partial | https://www.rundiffusion.com/juggernaut-xl-rundiffusion-guide `[medium]` |
| SDXL-Lightning / Hyper-SD LoRA | SDXL speed LoRA | +~0.4 GB | 4–8 steps | Euler + `sgm_uniform`, CFG ≈ 1; match steps to file; applies on top of other SDXL checkpoints | n/a | https://huggingface.co/ByteDance/SDXL-Lightning `[medium]` → `models/loras` |
| Z-Image Turbo | 6B DiT (bf16 split files) | "fits within 16GB"; 16 GB min / 32 GB rec. | ~90–160 s/image `[medium]` | Natural language, 8 steps, no negative (CFG 1) | Via Civitai LoRAs (ZIT NSFW LoRA etc.) `[low]`; Base-trained LoRAs may fail on Turbo | `z_image_turbo_bf16.safetensors` → `diffusion_models`, `qwen_3_4b.safetensors` → `text_encoders`, `ae.safetensors` → `vae` https://raw.githubusercontent.com/Comfy-Org/docs/main/tutorials/image/z-image/z-image-turbo.mdx |
| FLUX.1 schnell GGUF Q4/Q5 | 12B (Apache-2.0) | 16 GB marginal | ~4.5 min/image on M1 Pro 16 GB `[medium]`; 175 s/2 steps + 22 GB swap unquantized | Natural language, 4 steps, no negative | Weak natively; LoRAs | ComfyUI-GGUF `UnetLoaderGGUF`; https://huggingface.co/black-forest-labs/FLUX.1-schnell/discussions/13 , https://github.com/city96/ComfyUI-GGUF |
| FLUX.1 Kontext dev GGUF Q4_K_M (6.93 GB) | 12B edit model (non-commercial) | 16 GB opt-in, slow | minutes `[low]` | NL edit instruction + `ReferenceLatent` | n/a | https://huggingface.co/QuantStack/FLUX.1-Kontext-dev-GGUF `[medium]`, license https://github.com/black-forest-labs/flux |
| FLUX.2 Klein 4B (mflux) | 4B distilled | `-q4 --small-text-encoder` ≈ 3.3 GB weights | 24–25 s @1024 on M1 Max `[high]`; base M1 ~40–60 s est. | NL, 4 steps, `--guidance 1.0` | LoRAs | https://raw.githubusercontent.com/mflux-community/mflux/main/src/mflux/models/flux2/README.md |
| Z-Image Turbo (mflux -q4) | 6B | ~2 min/image est. | 65–67 s on M1 Max `[high]` | NL, 9 steps; ComfyUI-format LoRAs load | LoRAs | https://raw.githubusercontent.com/mflux-community/mflux/main/src/mflux/models/z_image/README.md |
| Qwen-Image / Qwen-Image-Edit-2509 | 20B + 7B VL encoder | fp8 20.4 GB (upcast 2× on MPS) — **exclude on 8/16 GB** | 64 GB Macs only | — | — | https://raw.githubusercontent.com/Comfy-Org/docs/main/tutorials/image/qwen/qwen-image.mdx |
| Chroma | 8.9B Flux-schnell derivative, Apache | 32 GB-class — exclude | — | NL, CFG 3–4, DPM++ 2M sgm_uniform | Uncensored | https://github.com/lodestone-rock/flow `[low]` |

**NSFW sourcing:** Civitai split on 15 Apr 2026: `civitai.com` = SFW only, `civitai.red` = SFW+NSFW (`domainBrowsingCeiling` returns all levels for "red"). Browsing levels are bit flags PG=1, PG13=2, R=4, X=8, XXX=16, Blocked=32. Docs and any in-app search must point at civitai.red. `[high]` https://raw.githubusercontent.com/civitai/civitai/main/src/shared/constants/browsingLevel.constants.ts , https://raw.githubusercontent.com/civitai/civitai/main/src/server/common/enums.ts

**Folder layout (ComfyUI):** `models/checkpoints`, `loras`, `vae`, `clip_vision`, `text_encoders` (alias `clip`), `diffusion_models` (alias `unet`), `controlnet`, `embeddings`, `upscale_models`, `vae_approx`, `style_models`; custom-node folders `models/ipadapter`, `models/pulid`, `models/instantid`, `models/insightface/models/antelopev2`, `models/animatediff_models`, `models/xlabs/ipadapters`. Extensions: `.ckpt .pt .pt2 .bin .pth .safetensors .pkl .sft`. `[high]` https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/folder_paths.py

**Agent prompt profiles** (the LLM system prompt must switch per checkpoint): `tag-style` (Pony, Illustrious, NoobAI, Animagine, SD1.5 anime) vs `natural-language` (Juggernaut, Realistic Vision, Flux, Z-Image, FLUX.2, Chroma); each profile carries quality tokens, default negative, sampler/scheduler/steps/CFG, clip-skip, resolution set, and whether negatives are honoured (Flux/Z-Image: CFG 1, ignore negative).

---

## 4. Persona consistency roadmap

**Stage 1 — Prompt-level persona (ship first)**
- Persona = structured profile `{name, age, hair, eyes, body, signature_outfit, art_style, quality_tokens, negative_prompt, checkpoint, lora[], trigger_word?, seed_set[]}`. The LLM expands it into every prompt; same checkpoint + fixed seed set per persona.
- Create from pasted images with a vision model (`qwen3-vl`, `huihui_ai/qwen3-vl-abliterated`) + `format` schema → persona description. Downscale refs to ~1024px, JPEG, raw base64 (no `data:` prefix). `[high]` https://raw.githubusercontent.com/ollama/ollama/main/docs/capabilities/vision.mdx
- Pose control: `comfyui_controlnet_aux` DWPose/OpenPose (CPU by default on Mac; use **TorchScript** variants `hr16/DWPose-TorchScript-BatchSize5`) → `control_v11p_sd15_openpose_fp16.safetensors` (SD1.5, ~700 MB) or `xinsir/controlnet-openpose-sdxl-1.0` / `thibaud/controlnet-openpose-sdxl-1.0` (~2.5 GB) in `models/controlnet`; `ControlNetApplyAdvanced` strength ~0.8, end_percent ~0.7. Cache pose skeletons per persona. `[high]` https://github.com/Fannovel16/comfyui_controlnet_aux , https://github.com/Comfy-Org/docs/blob/main/tutorials/controlnet/pose-controlnet-2-pass.mdx

**Stage 2 — Reference images via IP-Adapter (ComfyUI_IPAdapter_plus, maintenance-only since 2025-04-14, pin version)**
- Files (exact names): `models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors`, `CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors`; `models/ipadapter/ip-adapter-plus-face_sdxl_vit-h.safetensors` (SDXL), `ip-adapter-plus-face_sd15.safetensors` / `ip-adapter-full-face_sd15.safetensors` (SD1.5); FaceID `.bin` in `models/ipadapter` + matching `ip-adapter-faceid*_lora.safetensors` in `models/loras`. `[high]` https://github.com/cubiq/ComfyUI_IPAdapter_plus
- Nodes: `IPAdapterUnifiedLoader{preset:"PLUS FACE"}` → `IPAdapterAdvanced{weight 0.6–0.9, weight_type "linear" (identity) | "style transfer" (outfit/style), combine_embeds "average", start_at 0, end_at 0.8–1.0}`; 1–4 refs via `IPAdapterEncoder`/`IPAdapterBatch`. Upload refs with `POST /upload/image` (type input).
- FaceID / InstantID (SDXL-only; `models/instantid/ip-adapter.bin`, InstantID ControlNet in `models/controlnet`, antelopev2 in `models/insightface/models/antelopev2`) unlock after a dependency check: `pip install -U insightface onnxruntime` — insightface 2.1 (Oct 2026) ships a `py3-none-any` wheel, Python ≥ 3.10, face3d not compiled by default, which should remove the historic macOS arm64 build failures (#2538, ReActor #58 "cmath not found"). Provider `CPU` or `CoreML`. insightface is non-commercial. `[high]` https://pypi.org/project/insightface/ , https://github.com/cubiq/ComfyUI_InstantID , https://github.com/cubiq/ComfyUI_IPAdapter_plus/issues/493
- **Skip** PuLID-Flux on Mac: ApplyPulidFlux calls xformers `memory_efficient_attention` (CUDA-only) → fails on MPS (issue #54, open); Enhanced fork discontinued 2025-10-07 recommending Kontext/Qwen-Edit. SDXL PuLID (`models/pulid/ip-adapter_pulid_sdxl_fp16.safetensors`) is unverified on MPS — experimental only. `[high]` https://github.com/balazik/ComfyUI-PuLID-Flux/issues/54 , https://github.com/sipie800/ComfyUI-PuLID-Flux-Enhanced , https://github.com/cubiq/PuLID_ComfyUI
- Flux Redux (`models/style_models/flux1-redux-dev.safetensors` + `models/clip_vision/sigclip_vision_patch14_384.safetensors`, `StyleModelApply strength, strength_type multiply|attn_bias`) is style/subject conditioning, **not** identity lock. `[high]` https://github.com/comfyanonymous/ComfyUI_examples/blob/master/flux/README.md
- Flux Kontext dev Q4_K_M GGUF + `ReferenceLatent` (§2.3) = opt-in "same character, new pose/outfit" edit mode, 16 GB only, minutes per image. XLabs Flux IP-Adapter (`models/xlabs/ipadapters`) is beta and Flux-dev sized — not a priority. `[medium]` https://github.com/XLabs-AI/x-flux-comfyui

**Stage 3 — Persona LoRA**
- Dataset UI: 15–30 varied images (SDXL ≥ 20, FLUX ≥ 15; "25 varied beat 60 near-duplicates"), vary pose/outfit/lighting/angle; captions start with a unique trigger token (`ohwx_<persona>`), omit face/eyes/skin/hair, describe everything else; SDXL booru tags, FLUX prose; rank/alpha SDXL 32/16, FLUX 16/16; ~120×images steps clamped 1500–3500, checkpoint every 250 steps. `[medium]` https://github.com/perfectgf/lora-dataset-studio/blob/v1/docs/DATASET_GUIDE.md
- Training on-device (M1 16 GB) — honest status:
  - kohya sd-scripts: no MPS support in README (Windows/Linux/WSL2 CUDA only); community: M1 Air 16 GB ~45 s/step SD1.5 512px (2023); M1 Max 64 GB SD1.5 1.41 s/it (~35 min/1500 steps), SDXL 6–14 s/it (2.5–5 h); SDXL 1024 OOM on M1 Pro 16 GB; use mixed precision "no". `[high]` https://github.com/kohya-ss/sd-scripts , https://github.com/bmaltais/kohya_ss/issues/1248
  - OneTrainer: `install.sh` for Mac; "MPS reported working, no presets"; disable fp8 + compile; model-specific breakage. `[high]` https://github.com/Nerogar/OneTrainer/discussions/1693
  - ai-toolkit: `run_mac.zsh` "experimental"; FLUX.2 on MPS declared "a dead end" (#871). `[high]` https://github.com/ostris/ai-toolkit/issues/871
  - SimpleTuner: "Apple GPUs do not currently work for training Flux"; Chroma "works well" on MPS but needs 40–50 GB RAM. `[high]` https://github.com/bghira/SimpleTuner/blob/main/documentation/quickstart/FLUX.md
  - mflux-train: Z-Image/Z-Image-Turbo and FLUX.2 klein base 4B/9B; documented envelope 32–36 GB with gradient checkpointing + `quantize: 8` + `low_ram`. `[high]` https://github.com/mflux-community/mflux/blob/main/src/mflux/models/common/README.md
  - Draw Things: on-device SD1.5/SDXL LoRA training (SDXL 1024 needs 16–32 GB+); FLUX.2 klein / Z-Image training crashes at step 0 (issue #114, open). Most practical GUI path for SD1.5/SDXL. `[medium]` https://github.com/drawthingsai/draw-things-community/issues/114
  - **Recommendation:** export dataset folder; train SD1.5/SDXL in Draw Things (hours) or cloud CUDA (kohya/ai-toolkit, minutes); import `.safetensors` to `models/loras`.
- Loading: `LoraLoader{lora_name, strength_model 0.8, strength_clip 0.8}` (or `LoraLoaderModelOnly`), chain for multiple; persona LoRA record = `{file, base_model (SD1.5|SDXL|ZIT|ZIB), trigger_word, strength_model, strength_clip}`; the agent prepends the trigger word; refuse base-model mismatches. `[high]` https://github.com/Comfy-Org/docs/blob/main/tutorials/basic/lora.mdx

---

## 5. Video

**Verdict:** On M1 **8 GB: disabled** (document images only). On M1 **16 GB: opt-in EXPERIMENTAL**, gated on `sysctl hw.memsize ≥ 16 GB`, with one supported preset (AnimateDiff SD1.5) and one secondary (LTX-Video 2B distilled), UI text "several minutes per clip; may be much longer". Everything else is not feasible.

**Why:**
- Wan 2.2 TI2V-5B in ComfyUI on Apple Silicon silently corrupts frames beyond ~9–17 frames in fp16/bf16/fp32 and GGUF Q8_0 (issue #15793, open since Aug 2026, no maintainer response); M5 base measured 412 s for 640×352×17. Official README targets a 24 GB GPU. `[high]` https://github.com/Comfy-Org/ComfyUI/issues/15793 , https://github.com/Wan-Video/Wan2.2
- LTX-2.x bf16 → all-black video on MPS unless `--use-split-cross-attention` (#15818/#15804); ComfyUI-LTXVideo "MAC - MPS Support" #302 open since Jan 2026; LTX-2 (19B)/2.5 (22B) need 32 GB+ (ltx-video-mac states 32 GB min). `[high]` https://github.com/Comfy-Org/ComfyUI/issues/15818 , https://github.com/Lightricks/ComfyUI-LTXVideo/issues/302 , https://github.com/james-see/ltx-video-mac
- Attention matrices ≥ ~2³¹ elements silently corrupt on MPS (#14837, fix PR #14838 open). `[high]` https://github.com/Comfy-Org/ComfyUI/issues/14837
- HunyuanVideo needs 64 GB Macs and still blacks out above 73 frames; FramePack >30 GB download / ~14.5–20 GB RAM; MLX Wan 5B BF16 = 21.2 GiB runtime (q8 dequantizes to BF16 at load); Mochi/CogVideoX have no Mac data. `[high/medium]` https://github.com/Comfy-Org/ComfyUI/discussions/15109 , https://github.com/brandon929/FramePack , https://pypi.org/project/mlx-gen/ , https://github.com/Blaizzy/mlx-video
- AnimateDiff-Evolved README explicitly lists "Mac M1/M2/M3 support"; LTX-Video README says MPS tested with torch 2.3.0 (2B distilled "~15× faster, no STG/CFG"); a commenter in #15793 reported LTX-Video 2B running clean where Wan corrupted. `[high]` https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved , https://github.com/Lightricks/LTX-Video

**Minimal workflow (AnimateDiff SD1.5 + VHS)**
Prereqs: `brew install ffmpeg`; custom nodes ComfyUI-AnimateDiff-Evolved + ComfyUI-VideoHelperSuite; motion module `v3_sd15_mm.ckpt` or `mm_sd_v15_v2.ckpt` in `models/animatediff_models`. Launch for video: `python main.py --force-fp16 --use-split-cross-attention --fp32-vae --disable-smart-memory` (+ `--cpu-vae` if VAE decode OOMs). `[high]` https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/comfy/cli_args.py
```jsonc
{
  "4":  { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "sd15/realisticVision_v60.safetensors" } },
  "70": { "class_type": "ADE_AnimateDiffLoaderGen1", "inputs": { "model": ["4",0], "model_name": "v3_sd15_mm.ckpt", "beta_schedule": "autoselect" } },  // verify exact class/widgets via /object_info
  "6":  { "class_type": "CLIPTextEncode", "inputs": { "text": "…", "clip": ["4",1] } },
  "7":  { "class_type": "CLIPTextEncode", "inputs": { "text": "…", "clip": ["4",1] } },
  "5":  { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512, "batch_size": 16 } },   // 16 frames
  "3":  { "class_type": "KSampler", "inputs": { "model": ["70",0], "positive": ["6",0], "negative": ["7",0], "latent_image": ["5",0], "seed": 1, "steps": 20, "cfg": 7.0, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0 } },
  "8":  { "class_type": "VAEDecode", "inputs": { "samples": ["3",0], "vae": ["4",2] } },
  "71": { "class_type": "VHS_VideoCombine", "inputs": { "images": ["8",0], "frame_rate": 8, "loop_count": 0, "filename_prefix": "persona_<id>/clip",
          "format": "video/h264-mp4", "pix_fmt": "yuv420p", "crf": 19, "save_metadata": true, "pingpong": false, "save_output": true } }
}
```
Never pick `nvenc_*` formats. LTX-Video 2B preset: frames must be `8n+1`, dims divisible by 32, fp16 files (not fp8).

**/history shape for video** `[high]` https://raw.githubusercontent.com/Kosinkadink/ComfyUI-VideoHelperSuite/main/videohelpersuite/nodes.py , https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/comfy_api/latest/_ui.py
```jsonc
// VHS_VideoCombine → outputs[nodeId].gifs[]  (NOT images[])
"71": { "gifs": [ { "filename": "clip_00001.mp4", "subfolder": "persona_<id>", "type": "output", "format": "video/h264-mp4", "frame_rate": 8.0, "workflow": "clip_00001.png", "fullpath": "/…/output/persona_<id>/clip_00001.mp4" } ] }
// core SaveVideo / SaveWEBM / SaveAnimatedWEBP → outputs[nodeId].images[] + animated flag
"72": { "images": [ { "filename": "ComfyUI_00001_.mp4", "subfolder": "video", "type": "output" } ], "animated": [true] }
```
Parser rule: read both `gifs[]` and `images[]`; treat as video when `animated?.[0] === true` or extension ∈ mp4/webm/mov/mkv/webp. Core alternative without custom nodes: `CreateVideo{images, fps}` → `SaveVideo{format:"mp4", codec:"h264"}` (default prefix `video/ComfyUI`). `[high]` https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/comfy_extras/nodes_video.py

Mention Draw Things as the manual GUI for Wan 2.2 5B on 16 GB (its FAQ lists 16 GB+ minimum for video `[medium]`); video via its API is only indirectly evidenced (gRPC client `to_video()`, per-model fps). https://wiki.drawthings.ai/wiki/Wan_2.2 , https://pypi.org/project/drawthings-py/

---

## 6. Next.js 16 engineering notes

**Versions (npm `latest`, 2026-11-02)** `[high]` https://registry.npmjs.org/ : `next 16.4.3`, `react`/`react-dom 19.3.1`, `tailwindcss`/`@tailwindcss/postcss 4.3.3`, `zustand 5.0.16`, `zod 4.6.7`, `lucide-react 1.66.0`, `typescript 7.0.2` (Go compiler, no JS API; alias `"typescript": "npm:@typescript/typescript6@^6.0.3"` if a plugin needs the API), `eslint 10.14.0` + `eslint-config-next 16.4.3` (flat config; `next lint` removed), `ollama 0.6.4`; optional `ai 7.0.159` + `ai-sdk-ollama 4.6.1`. Node **22 LTS** (Next needs ≥ 20.9; global WebSocket stable 22.4, `Readable.toWeb` stable 22.17, AI SDK Ollama providers need 22+). https://raw.githubusercontent.com/nodejs/node/v22.x/doc/api/globals.md , https://github.com/vercel/next.js/discussions/95633

**Next 16 breaking changes that affect this app** `[high]` https://raw.githubusercontent.com/vercel/next.js/canary/docs/01-app/02-guides/upgrading/version-16.mdx
- `params`/`searchParams`/`cookies()`/`headers()` are **async only**: `const { id } = await ctx.params` (use `npx next typegen` for `RouteContext<'/api/media/[id]'>`).
- `middleware.ts` → `proxy.ts` (Node runtime only; not needed here).
- Turbopack default for dev and build (`--webpack` opt-out; `experimental.turbopack` → top-level `turbopack`).
- `next dev` holds a lockfile in `.next/dev` — only one dev server per project.
- `next/image`: `qualities` default `[75]` required, `minimumCacheTTL` 4 h, `dangerouslyAllowLocalIP: false` (blocks 127.0.0.1:8188/view), `localPatterns` for query strings. → set `images: { unoptimized: true }` and use `<img>`/`<video>`. https://raw.githubusercontent.com/vercel/next.js/canary/docs/01-app/03-api-reference/02-components/image.mdx
- 16.4: strict route matching by default; `unstable_` prefixes removed from navigation/prefetch. `[medium]` https://github.com/vercel/next.js/releases/tag/v16.4.0
- `serverExternalPackages`: sharp, better-sqlite3, onnxruntime-node etc. are externalized by default; use the built-in WebSocket instead of `ws`. https://raw.githubusercontent.com/vercel/next.js/canary/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.mdx
- `compress` is on under `next start` and can buffer SSE → `Cache-Control: no-cache, no-transform` on streams or `compress: false`; test streaming in production mode. https://raw.githubusercontent.com/vercel/next.js/canary/docs/01-app/03-api-reference/05-config/01-next-config-js/compress.mdx
- `allowedDevOrigins` only needed if opening from a LAN hostname. https://raw.githubusercontent.com/vercel/next.js/canary/docs/01-app/03-api-reference/05-config/01-next-config-js/allowedDevOrigins.mdx

**next.config.ts**
```ts
import type { NextConfig } from 'next';
const config: NextConfig = {
  images: { unoptimized: true },
  compress: false,                      // keep SSE unbuffered under `next start`
  env: {},                              // read COMFYUI_URL / OLLAMA_URL from process.env server-side only
};
export default config;
```

**SSE relay route: `app/api/comfy/generate/route.ts`** (Node WebSocket → SSE; no CORS flag needed)
```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMFY = process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188';

export async function POST(req: Request) {
  const { workflow } = await req.json();
  const clientId = crypto.randomUUID();
  const promptId = crypto.randomUUID();          // lowercase canonical UUID required
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const ws = new WebSocket(`${COMFY.replace(/^http/, 'ws')}/ws?clientId=${clientId}`);
      ws.binaryType = 'arraybuffer';
      await new Promise<void>((ok, bad) => { ws.onopen = () => ok(); ws.onerror = () => bad(new Error('ws')); });

      ws.onmessage = async (ev) => {
        if (typeof ev.data === 'string') {
          const msg = JSON.parse(ev.data) as { type: string; data: any };
          if (msg.data?.prompt_id && msg.data.prompt_id !== promptId) return;
          send(msg.type, msg.data);
          const done = (msg.type === 'executing' && msg.data.node === null) ||
                       msg.type === 'execution_error' || msg.type === 'execution_interrupted';
          if (done) {
            const hist = await fetch(`${COMFY}/history/${promptId}`).then(r => r.json());
            send('history', hist[promptId] ?? null);   // caller persists outputs[*].images|gifs via /view
            ws.close(); controller.close();
          }
        } else {
          const dv = new DataView(ev.data as ArrayBuffer);
          if (dv.getUint32(0) === 1) {                  // PREVIEW_IMAGE
            const mime = dv.getUint32(4) === 1 ? 'image/jpeg' : 'image/png';
            const b64 = Buffer.from((ev.data as ArrayBuffer).slice(8)).toString('base64');
            send('preview', { mime, b64 });
          }
        }
      };

      const res = await fetch(`${COMFY}/prompt`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: clientId, prompt_id: promptId }),
      });
      if (!res.ok) { send('error', await res.json()); ws.close(); controller.close(); return; }
      send('queued', await res.json());

      req.signal.addEventListener('abort', () => { ws.close(); try { controller.close(); } catch {} });
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
```
`[high]` route handler + ReadableStream pattern: https://raw.githubusercontent.com/vercel/next.js/canary/docs/01-app/03-api-reference/03-file-conventions/route.mdx (SSE itself is not documented officially)

**Media route: `app/api/media/[id]/route.ts`**
```ts
import { Readable } from 'node:stream';
import { createReadStream, statSync } from 'node:fs';
export const dynamic = 'force-dynamic';
export async function GET(_req: Request, ctx: RouteContext<'/api/media/[id]'>) {
  const { id } = await ctx.params;
  const file = lookupMedia(id);                         // app-owned index → absolute path + mime (image/png, image/webp, video/mp4)
  if (!file) return new Response('not found', { status: 404 });
  const size = statSync(file.path).size;
  return new Response(Readable.toWeb(createReadStream(file.path)) as ReadableStream, {
    headers: { 'Content-Type': file.mime, 'Content-Length': String(size), 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
}
```
Copy ComfyUI outputs from `/view` into the app data dir rather than hot-linking (`/view` may set `Content-Disposition: attachment`).

**Ollama NDJSON loop (Node 22 fetch)** `[high]` https://raw.githubusercontent.com/ollama/ollama-js/main/src/utils.ts
```ts
const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal });
const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = '';
for (;;) {
  const { done, value } = await reader.read(); if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n'); buf = lines.pop() ?? '';
  for (const l of lines) { if (!l.trim()) continue; const j = JSON.parse(l);
    if (j.error) throw new Error(j.error);
    // accumulate j.message.content / .thinking / .tool_calls; j.done → stats
  }
}
```
Agent loop: stream content tokens to the client as SSE; accumulate `tool_calls` across chunks; execute (`generate_images` → ComfyUI); append `role:"tool"` messages; loop until no tool_calls. Prefer `format` JSON schema for small models. Memory choreography: Ollama `keep_alive: 0` after the LLM turn on 8 GB → ComfyUI batch → optionally `POST /free {unload_models:true, free_memory:true}` before the next LLM turn.

**Vercel AI SDK (optional)**: Ollama's OpenAI-compatible stream labels every tool call `index 0`; `@ai-sdk/provider-utils` ≥ 5.0.55 (ai 7.0.159 bundles 5.0.72) tolerates it, but `/v1` cannot pass `think`/`num_ctx`/`keep_alive` and has no `tool_choice`. If using the SDK, use `ai-sdk-ollama` 4.x (native API, "recommended when you need reliable tool calling") and `stopWhen: stepCountIs(n)` (AI SDK 7 defaults to one step). `[high]` https://github.com/vercel/ai/pull/22149 , https://raw.githubusercontent.com/vercel/ai/main/content/providers/05-community-providers/30-ollama.mdx , https://github.com/jagreehal/ai-sdk-ollama

**Settings page**: COMFYUI_URL (probe 8188 → 8000, show `/system_stats` version/device/argv), OLLAMA_URL, LM Studio URL, RAM tier (auto from `/system_stats.system.ram_total`), launch-flag helper text, dependency check (insightface/onnxruntime, ffmpeg, ComfyUI-GGUF, controlnet_aux, AnimateDiff, VHS).

---

## 7. Known pitfalls on macOS / MPS (consolidated)

1. **No CORS from the browser to ComfyUI** without `--enable-cors-header http://localhost:3000` (403 via origin-only middleware). Proxy through Next.js. Never combine `--listen 0.0.0.0` with a bare `--enable-cors-header` (exposes an NSFW-capable server to the LAN). https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/server.py
2. **Always send `client_id`** and open the WS first; without it the `executing{node:null}` sentinel and `execution_start/success/error` are never sent (corrected). https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/main.py
3. **`prompt_id` must be a canonical lowercase hyphenated UUID** or 400 `invalid_prompt_id`.
4. **Port confusion**: Comfy Desktop v1.x managed installs default to **8188**; adopted legacy v0.x installs and the archived Electron app use **8000**. Probe both. https://raw.githubusercontent.com/Comfy-Org/Comfy-Desktop/main/src/main/lib/util.ts
5. **`--lowvram/--novram/--highvram/--normalvram` are no-ops on MPS** (SHARED). Manage memory by model choice, resolution, sequential seeds, `--cache-none`, `--disable-smart-memory`. (Topic-3's `--lowvram` advice for 8 GB is therefore redundant; text encoders already run on CPU under SHARED.) https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy/model_management.py
6. **fp8 files never load on MPS** (`*_fp8_e4m3fn*`, Flux/Kontext/Qwen/Wan fp8, t5xxl_fp8). Use fp16/bf16 or GGUF K-quants (not IQ quants). GGUF still dequantizes to 16-bit at runtime (saves disk, not RAM). `--force-channels-last` also errors. https://github.com/Comfy-Org/ComfyUI/issues/10292 , https://github.com/city96/ComfyUI-GGUF
7. **bf16 has no hardware fast path on M1–M3**; on macOS 14+ ComfyUI runs the SD/SDXL VAE in bf16 by default (corrected). PR #16996 measured bf16 VAE decode 5–10× slower than fp16 on M1 Max. Tradeoff: `--fp16-vae` is faster but help text warns "might cause black images" (and a #10292 commenter saw black images with fp16 VAE; stock SDXL VAE in fp16 is community-reported to overflow `[low]`). Decision tree: default → if VAE decode is the bottleneck try `--fp16-vae` (with an fp16-fix SDXL VAE) → if black images, `--fp32-vae`. Do **not** `--force-fp16` on bf16-native models (Z-Image, Qwen): black images. https://github.com/Comfy-Org/ComfyUI/pull/16996
8. **Black/NaN images**: add `--force-upcast-attention` (ComfyUI already force-upcasts on macOS ≥ 14.5) or `--fp32-vae`; macOS 14.4 had a solid-colour MPS regression fixed in later torch. https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy/cli_args.py
9. **MPS VAE correctness bug**: Qwen-Image VAE round-trip PSNR 6.6 dB on PyTorch 2.14 (#16433); `--cpu-vae` workaround, fixed in 2.15 nightly. Add a VAE round-trip sanity check to diagnostics. https://github.com/Comfy-Org/ComfyUI/issues/16433
10. **`EmptyLatentImage` defaults to 1024×1024** — always set width/height (512×768 for SD1.5).
11. **Attention**: default sub-quadratic on MPS; `--use-pytorch-cross-attention` worth benchmarking; `--use-split-cross-attention` fixes bf16 black video and some OOMs; the three flags are mutually exclusive. https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy/ldm/modules/attention.py
12. **MPS allocator**: `PYTORCH_MPS_HIGH_WATERMARK_RATIO` must be raised together with `PYTORCH_MPS_LOW_WATERMARK_RATIO` or torch errors; `0.0` removes the guard and can freeze the Mac — don't recommend. `PYTORCH_ENABLE_MPS_FALLBACK=1` for unsupported ops. https://dev.to/nefayran/mps-backend-out-of-memory-on-a-mac-what-the-numbers-mean-and-how-to-set-the-watermark-43dp
13. **PyTorch version churn**: torch 2.6.0 broke `aten::_linalg_solve_ex` on MPS; ComfyUI-GGUF hit "M1 buffer is not large enough" with 2.6 nightlies on Sequoia (needed 2.4.1); numpy 2.x broke some nodes (pin 1.26.4 if needed). Pin a tested torch/numpy in the installer. https://github.com/Comfy-Org/ComfyUI/discussions/3283
14. **Previews off by default** (`--preview-method none`); binary frames carry a 4-byte event id to parse or skip.
15. **Ollama context 4k default** on <24 GiB Macs; `modelfile.mdx` still says 2048 — set `options.num_ctx` explicitly. https://raw.githubusercontent.com/ollama/ollama/main/docs/context-length.mdx
16. **Thinking models** (qwen3/3.5, gemma4, gpt-oss) reason by default → minutes per reply on M1; send `think:false`.
17. **Small models and free-form tools**: hallucinated/missing calls; use `format` schema + zod validation + retry; keep tool schemas minimal.
18. **Ollama env vars** for the menu-bar app need `launchctl setenv` + restart (not persistent across reboots); shell exports don't reach Ollama.app.
19. **Vision model churn**: llama3.2-vision broken (mllama), Qwen3.5 image input reported broken mid-2026 `[low]` — test `/api/show capabilities` + a real image; fall back to qwen3-vl/gemma4.
20. **insightface/onnxruntime** (FaceID, InstantID, PuLID) historically failed to build on arm64; insightface 2.1 pure-python wheel should fix it — verify in CI, provider CPU/CoreML; non-commercial license.
21. **DWPose on CPU** by default on Mac — use TorchScript variants; cache skeletons.
22. **Prompt format is checkpoint-specific** (Pony score prefix + clip-skip 2; NoobAI v-pred no Karras; Flux/Z-Image ignore negatives) — one generic prompt writer breaks on half the models.
23. **Civitai NSFW moved to civitai.red** (Apr 2026); civitai.com/civitai.green are SFW only.
24. **Video**: Wan corrupts on MPS (#15793), LTX bf16 black without split attention, VHS needs ffmpeg, VHS outputs are under `gifs[]` not `images[]`, never `nvenc_*`.
25. **Next 16**: async params; `next dev` lockfile; gzip may buffer SSE under `next start`; image optimizer blocks local IPs; TS 7 has no JS API; `next lint` gone.
26. **Licensing**: FLUX.1 dev / Kontext dev / Redux dev are non-commercial; schnell, Chroma, Z-Image, Qwen are permissive — surface in the picker. https://github.com/black-forest-labs/flux

---

## 8. Open questions / low-confidence items

1. **VAE precision default on M1**: bf16 (default on macOS 14+) vs `--fp16-vae` (faster, black-image risk) vs `--fp32-vae` (safe, slower) — needs an on-device benchmark + black-image test for SD1.5, SDXL and Z-Image before fixing the installer default. PR #16996 status should be re-checked.
2. **MLX runner on 8/16 GB M1**: no memory gate in source, but no performance data for qwen3.5/gemma4 MLX manifests on small Macs; measure tok/s vs GGUF.
3. **Model sizes** for qwen3.5/qwen3-vl/gemma4/huihui_ai tags came from search snippets (ollama.com, HF unreachable); show `/api/tags.size` instead of hardcoding. Gemma 4 `12b` tag unverified.
4. **huihui_ai abliterated tags** (qwen3-abliterated sizes, gemma3 ≥ 0.6 requirement, "crude proof-of-concept" wording) unverified; check live pages before hardcoding names.
5. **Qwen3.5 vision in Ollama** reportedly broken mid-2026 `[low]`; test before making qwen3.5 the single agent+vision model.
6. **SD1.5/SDXL speed on base M1** (15–70 s SD1.5; 60–110 s SDXL) are secondary/low-confidence; the app should measure and display real per-image timings.
7. **Pony/NoobAI/Illustrious/Animagine/Realistic Vision settings** come from search summaries of model cards (HF/Civitai unreachable) — `[medium/low]`; re-verify prompt templates against the cards.
8. **Z-Image NSFW LoRA compatibility** (Base-trained vs Turbo) `[low]`; test in ComfyUI and mflux.
9. **IPAdapter preset enum strings and controlnet_aux widget names** must be read from `/object_info` at runtime; the research lists display names.
10. **insightface 2.1 on macOS arm64** — "should" install cleanly; unconfirmed on M1 specifically.
11. **Draw Things video over API**: HTTP txt2img confirmed; video only indirectly via gRPC client (`numFrames` 32n+1 from a third-party plugin `[low]`); verify against the proto. Wiki's "16 GB minimum for video" is from snippets.
12. **LTX-Video 2B distilled on M1 16 GB**: only one M5 anecdote of clean output; no timings.
13. **ComfyUI-AppleSilicon-FP8** node as an opt-in fp8 compatibility layer — untested here; author says it is not a performance library.
14. **mflux on base M1 16 GB**: all benchmarks are M1 Max 64 GB; memory headroom for Z-Image Turbo q4 + text encoder on 16 GB unverified.
15. **Comfy Desktop macOS default install dir** (`~/ComfyUI-Installs`) is documented for Linux only; Comfy-Org docs mention `~/ComfyUI-Shared` for models — detect both.
16. **gpt-oss:20b ~14 GB download / "marginal on 16 GB"** anecdotes unverified from primary sources (irrelevant since excluded).
17. Hosts unreachable during research (claims depending on them remain snippet-based): ollama.com, registry.ollama.ai, huggingface.co, civitai.com, lmstudio.ai, docs.comfy.org, docs.photoprism.app, blog.google, ai.google.dev, gizmodo.jp, lilting.ch, wiki.drawthings.ai, developer.civitai.com, nextjs.org, ai-sdk.dev, vercel.com, tailwindcss.com.