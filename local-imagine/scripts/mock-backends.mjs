#!/usr/bin/env node
/**
 * Mock Ollama (port 11435) + mock ComfyUI (port 8189) for developing / testing the UI
 * without a GPU or any models installed.
 *
 *   node scripts/mock-backends.mjs
 *   OLLAMA_URL=http://127.0.0.1:11435 COMFYUI_URL=http://127.0.0.1:8189 npm run dev
 *
 * The mock LLM returns a fixed plan that generates 2 images; the mock ComfyUI renders a
 * coloured gradient PNG after a short "progress" sequence over the WebSocket.
 */
import http from "node:http";
import { createRequire } from "node:module";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("ws");

const OLLAMA_PORT = Number(process.env.MOCK_OLLAMA_PORT || 11435);
const COMFY_PORT = Number(process.env.MOCK_COMFY_PORT || 8189);
const STEP_MS = Number(process.env.MOCK_STEP_MS || 120);

// ----------------------------------------------------------------- tiny PNG encoder
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(width, height, seed) {
  const rows = [];
  const r0 = (seed * 97) % 255, g0 = (seed * 57) % 255, b0 = (seed * 31) % 255;
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const t = x / width, u = y / height;
      row[1 + x * 3] = (r0 + t * 120) & 0xff;
      row[2 + x * 3] = (g0 + u * 120) & 0xff;
      row[3 + x * 3] = (b0 + (1 - t) * u * 160) & 0xff;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

// ----------------------------------------------------------------- mock Ollama
const ollama = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/version") return sendJson(res, 200, { version: "0.0.0-mock" });
  if (url.pathname === "/api/tags") {
    return sendJson(res, 200, {
      models: [
        { name: "mock-llm:latest", size: 1, modified_at: new Date().toISOString(), details: { family: "mock", parameter_size: "0B", quantization_level: "Q0" } },
        { name: "mock-vision:latest", size: 1, modified_at: new Date().toISOString(), details: { family: "mock", parameter_size: "0B" } },
      ],
    });
  }
  if (url.pathname === "/api/chat" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const last = body.messages?.at(-1)?.content ?? "";
    const hasImages = body.messages?.some((m) => m.images?.length);
    let content;
    if (hasImages) {
      content = "A young adult woman with long dark hair and brown eyes, wearing a white blouse, smiling, upper body, soft window light, photo style.";
    } else if (/^(hi|hello|こんにちは|やあ)/i.test(last.trim())) {
      content = JSON.stringify({ reply: "こんにちは！どんな画像を作りましょう？", generations: [] });
    } else {
      const m = /(\d+)\s*(枚|images?)/.exec(last);
      const count = m ? Math.min(8, Number(m[1])) : 2;
      content = JSON.stringify({
        reply: `了解です。「${last.slice(0, 20)}」のイメージで ${count} 枚生成します。`,
        generations: [
          {
            prompt: "1girl, solo, sitting at a cafe table, holding a coffee cup, gentle smile, looking at viewer, cowboy shot, warm afternoon light, bokeh background",
            negative_prompt: "extra fingers, text",
            count,
            aspect: "2:3",
            use_reference_images: true,
          },
        ],
      });
    }
    await new Promise((r) => setTimeout(r, 300));
    return sendJson(res, 200, { model: body.model, message: { role: "assistant", content }, done: true, total_duration: 1 });
  }
  sendJson(res, 404, { error: "not found" });
});

// ----------------------------------------------------------------- mock ComfyUI
const history = new Map();
const outputs = new Map(); // filename -> Buffer
const inputs = new Map();
const clients = new Map(); // clientId -> ws
let queue = Promise.resolve();

const comfy = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/system_stats") {
    return sendJson(res, 200, {
      system: { os: "darwin", python_version: "3.12 (mock)", comfyui_version: "mock" },
      devices: [{ name: "mps (mock)", type: "mps", vram_total: 16e9, vram_free: 8e9 }],
    });
  }
  if (url.pathname === "/object_info") {
    const combo = (opts) => [opts, {}];
    return sendJson(res, 200, {
      CheckpointLoaderSimple: { input: { required: { ckpt_name: combo(["ponyDiffusionV6XL.safetensors", "illustriousXL_v01.safetensors", "realisticVisionV60_v51VAE.safetensors"]) } } },
      LoraLoader: { input: { required: { lora_name: combo(["my_persona_lora.safetensors"]) } } },
      VAELoader: { input: { required: { vae_name: combo(["sdxl_vae.safetensors", "wan2.2_vae.safetensors"]) } } },
      UNETLoader: { input: { required: { unet_name: combo(["wan2.2_ti2v_5B_fp16.safetensors"]) } } },
      CLIPLoader: { input: { required: { clip_name: combo(["umt5_xxl_fp8_e4m3fn_scaled.safetensors"]) } } },
      KSampler: { input: { required: { sampler_name: combo(["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "uni_pc"]), scheduler: combo(["normal", "karras", "simple", "sgm_uniform"]) } } },
      IPAdapterUnifiedLoader: { input: { required: { preset: combo(["LIGHT - SD1.5 only (low strength)", "STANDARD (medium strength)", "VIT-G (medium strength)", "PLUS (high strength)", "PLUS FACE (portraits)", "FULL FACE - SD1.5 only (portraits stronger)"]) } } },
      IPAdapterModelLoader: { input: { required: { ipadapter_file: combo(["ip-adapter-plus_sdxl_vit-h.safetensors", "ip-adapter-plus-face_sd15.safetensors"]) } } },
      IPAdapterAdvanced: { input: { required: { weight_type: combo(["linear", "ease in", "style transfer"]), combine_embeds: combo(["concat", "add", "average"]), embeds_scaling: combo(["V only", "K+V"]) } } },
      Wan22ImageToVideoLatent: { input: {} },
      CreateVideo: { input: {} },
      SaveVideo: { input: {} },
    });
  }
  if (url.pathname === "/upload/image" && req.method === "POST") {
    const body = await readBody(req);
    const name = /filename="([^"]+)"/.exec(body.toString("latin1"))?.[1] ?? `upload_${Date.now()}.png`;
    inputs.set(name, body);
    return sendJson(res, 200, { name, subfolder: "local-imagine", type: "input" });
  }
  if (url.pathname === "/prompt" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString());
    const promptId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const wf = body.prompt;
    const saveNode = Object.entries(wf).find(([, n]) => n.class_type === "SaveImage" || n.class_type === "SaveVideo" || n.class_type === "VHS_VideoCombine");
    const latent = Object.values(wf).find((n) => n.class_type === "EmptyLatentImage" || n.class_type === "Wan22ImageToVideoLatent");
    const sampler = Object.values(wf).find((n) => n.class_type === "KSampler");
    const ckptNode = Object.values(wf).find((n) => n.class_type === "CheckpointLoaderSimple");
    if (ckptNode && ckptNode.inputs.ckpt_name === "missing.safetensors") {
      return sendJson(res, 400, { error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" }, node_errors: { "1": { class_type: "CheckpointLoaderSimple", errors: [{ message: "Value not in list", details: "ckpt_name: 'missing.safetensors'" }] } } });
    }
    const width = Math.min(Number(latent?.inputs.width ?? 512), 512);
    const height = Math.min(Number(latent?.inputs.height ?? 512), 768);
    const steps = Number(sampler?.inputs.steps ?? 10);
    const seed = Number(sampler?.inputs.seed ?? 0);
    const isVideo = saveNode?.[1].class_type !== "SaveImage";
    history.set(promptId, { outputs: {}, status: { status_str: "pending", completed: false } });
    sendJson(res, 200, { prompt_id: promptId, number: history.size, node_errors: {} });

    const ws = clients.get(body.client_id);
    const emit = (type, data) => ws?.readyState === 1 && ws.send(JSON.stringify({ type, data }));
    queue = queue.then(async () => {
      emit("execution_start", { prompt_id: promptId });
      emit("executing", { node: Object.keys(wf)[0], prompt_id: promptId });
      for (let i = 1; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, STEP_MS));
        emit("progress", { value: i, max: steps, prompt_id: promptId, node: "KSampler" });
      }
      const filename = `${(saveNode?.[1].inputs.filename_prefix ?? "mock").split("/").pop()}_${seed}_.${isVideo ? "mp4" : "png"}`;
      outputs.set(filename, isVideo ? Buffer.from("not-a-real-mp4") : makePng(width, height, seed));
      const isVhs = saveNode?.[1].class_type === "VHS_VideoCombine";
      // Real shapes: SaveImage/SaveVideo -> images[] (+animated for video); VHS_VideoCombine -> gifs[] with format/frame_rate
      const output = isVhs
        ? { gifs: [{ filename, subfolder: "", type: "output", format: "video/h264-mp4", frame_rate: 8 }] }
        : { images: [{ filename, subfolder: "", type: "output" }], ...(isVideo ? { animated: [true] } : {}) };
      emit("executed", { node: saveNode?.[0], prompt_id: promptId, output });
      // Real ordering: execution_success is sent before history is written; executing{node:null} after.
      emit("execution_success", { prompt_id: promptId });
      await new Promise((r) => setTimeout(r, 30));
      history.set(promptId, { outputs: { [saveNode?.[0] ?? "9"]: output }, status: { status_str: "success", completed: true, messages: [] } });
      emit("executing", { node: null, prompt_id: promptId });
    });
    return;
  }
  if (url.pathname.startsWith("/history/")) {
    const id = url.pathname.slice("/history/".length);
    const h = history.get(id);
    return sendJson(res, 200, h ? { [id]: h } : {});
  }
  if (url.pathname === "/view") {
    const buf = outputs.get(url.searchParams.get("filename"));
    if (!buf) return sendJson(res, 404, { error: "no file" });
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(buf);
  }
  if (url.pathname === "/interrupt" || url.pathname === "/queue") return sendJson(res, 200, {});
  sendJson(res, 404, { error: "not found" });
});

const wss = new WebSocketServer({ server: comfy, path: "/ws" });
wss.on("connection", (ws, req) => {
  const clientId = new URL(req.url, "http://x").searchParams.get("clientId");
  if (clientId) clients.set(clientId, ws);
  ws.send(JSON.stringify({ type: "status", data: { status: { exec_info: { queue_remaining: 0 } }, sid: clientId } }));
  ws.on("close", () => clientId && clients.delete(clientId));
});

ollama.listen(OLLAMA_PORT, "127.0.0.1", () => console.log(`mock ollama  → http://127.0.0.1:${OLLAMA_PORT}`));
comfy.listen(COMFY_PORT, "127.0.0.1", () => console.log(`mock comfyui → http://127.0.0.1:${COMFY_PORT}`));
