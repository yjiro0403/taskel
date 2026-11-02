import WebSocket from "ws";
import { ImageModelCatalog } from "@/lib/types";

/**
 * ComfyUI HTTP + WebSocket client.
 * API reference: ComfyUI/server.py and script_examples/websockets_api_example.py in the ComfyUI repo.
 *
 * A workflow is submitted in "API format" (the JSON you get from "Save (API format)" in the UI):
 *   { "<node_id>": { "class_type": "KSampler", "inputs": { "seed": 1, "model": ["4", 0], ... } }, ... }
 */

export type ApiWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

export interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: string; // "output" | "temp" | "input"
  format?: string;
  nodeId: string;
}

export interface ComfyProgress {
  value: number;
  max: number;
  node?: string;
}

export class ComfyError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = "ComfyError";
  }
}

function joinUrl(base: string, p: string): string {
  return base.replace(/\/+$/, "") + p;
}

async function http<T>(base: string, p: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), init.timeoutMs ?? 15000);
  try {
    const res = await fetch(joinUrl(base, p), { ...init, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep text */
      }
      throw new ComfyError(`ComfyUI ${p} failed: ${res.status} ${text.slice(0, 500)}`, parsed);
    }
    const ct = res.headers.get("content-type") ?? "";
    return (ct.includes("application/json") ? await res.json() : await res.text()) as T;
  } catch (err) {
    if (err instanceof ComfyError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComfyError(`ComfyUI unreachable at ${base} (${msg}). Is ComfyUI running with --listen 127.0.0.1 --port 8188?`);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- discovery

export interface SystemStats {
  system: { os: string; python_version: string; comfyui_version?: string; pytorch_version?: string };
  devices: Array<{ name: string; type: string; vram_total: number; vram_free: number }>;
}

export async function systemStats(base: string): Promise<SystemStats> {
  return http<SystemStats>(base, "/system_stats", { timeoutMs: 4000 });
}

type ObjectInfo = Record<
  string,
  { input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> }; output_node?: boolean }
>;

let objectInfoCache: { base: string; at: number; info: ObjectInfo } | null = null;

export async function getObjectInfo(base: string, force = false): Promise<ObjectInfo> {
  if (!force && objectInfoCache && objectInfoCache.base === base && Date.now() - objectInfoCache.at < 60_000) {
    return objectInfoCache.info;
  }
  const info = await http<ObjectInfo>(base, "/object_info", { timeoutMs: 30000 });
  objectInfoCache = { base, at: Date.now(), info };
  return info;
}

function comboOptions(info: ObjectInfo, cls: string, input: string): string[] {
  const spec = info[cls]?.input?.required?.[input] ?? info[cls]?.input?.optional?.[input];
  const first = Array.isArray(spec) ? spec[0] : undefined;
  return Array.isArray(first) ? (first as unknown[]).filter((x): x is string => typeof x === "string") : [];
}

export async function getImageModelCatalog(base: string, force = false): Promise<ImageModelCatalog> {
  const info = await getObjectInfo(base, force);
  return {
    checkpoints: comboOptions(info, "CheckpointLoaderSimple", "ckpt_name"),
    loras: comboOptions(info, "LoraLoader", "lora_name"),
    vaes: comboOptions(info, "VAELoader", "vae_name"),
    samplers: comboOptions(info, "KSampler", "sampler_name"),
    schedulers: comboOptions(info, "KSampler", "scheduler"),
    unets: comboOptions(info, "UNETLoader", "unet_name"),
    clips: comboOptions(info, "CLIPLoader", "clip_name"),
    hasIPAdapter: "IPAdapterUnifiedLoader" in info && "IPAdapterAdvanced" in info,
    ipAdapterPresets: comboOptions(info, "IPAdapterUnifiedLoader", "preset"),
    ipAdapterFiles: comboOptions(info, "IPAdapterModelLoader", "ipadapter_file"),
    ipAdapterWeightTypes: comboOptions(info, "IPAdapterAdvanced", "weight_type"),
    ipAdapterCombineEmbeds: comboOptions(info, "IPAdapterAdvanced", "combine_embeds"),
    ipAdapterEmbedsScaling: comboOptions(info, "IPAdapterAdvanced", "embeds_scaling"),
    hasWanVideo: "Wan22ImageToVideoLatent" in info && "SaveVideo" in info && "CreateVideo" in info,
    hasAnimateDiff: "ADE_AnimateDiffLoaderGen1" in info && "VHS_VideoCombine" in info,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- files

export interface UploadedInput {
  name: string;
  subfolder: string;
  type: string;
}

/** Upload an image into ComfyUI's input folder so LoadImage can reference it. */
export async function uploadImage(base: string, data: Buffer, filename: string, subfolder = "local-imagine"): Promise<UploadedInput> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(data)]), filename);
  form.append("overwrite", "true");
  form.append("subfolder", subfolder);
  form.append("type", "input");
  const r = await http<{ name: string; subfolder: string; type: string }>(base, "/upload/image", {
    method: "POST",
    body: form,
    timeoutMs: 60000,
  });
  return { name: r.name, subfolder: r.subfolder ?? "", type: r.type ?? "input" };
}

/** LoadImage expects "subfolder/name" when the file is in a subfolder of input/. */
export function loadImageRef(u: UploadedInput): string {
  return u.subfolder ? `${u.subfolder}/${u.name}` : u.name;
}

export async function fetchOutput(base: string, f: Pick<ComfyOutputFile, "filename" | "subfolder" | "type">): Promise<Buffer> {
  const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? "", type: f.type ?? "output" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(joinUrl(base, `/view?${q}`), { signal: controller.signal });
    if (!res.ok) throw new ComfyError(`ComfyUI /view failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- execution

export async function queuePrompt(base: string, workflow: ApiWorkflow, clientId: string): Promise<string> {
  let r: { prompt_id: string; number: number; node_errors: Record<string, unknown> };
  try {
    r = await http(base, "/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      timeoutMs: 30000,
    });
  } catch (err) {
    // Validation failures come back as HTTP 400 with {error, node_errors}
    const details = err instanceof ComfyError ? (err.details as { node_errors?: unknown; error?: { message?: string } } | undefined) : undefined;
    if (details && typeof details === "object" && details.node_errors && Object.keys(details.node_errors as object).length > 0) {
      throw new ComfyError(`ComfyUI rejected the workflow: ${summariseNodeErrors(details.node_errors)}`, details);
    }
    if (details && typeof details === "object" && details.error?.message) {
      throw new ComfyError(`ComfyUI rejected the workflow: ${details.error.message}`, details);
    }
    throw err;
  }
  if (r.node_errors && Object.keys(r.node_errors).length > 0) {
    throw new ComfyError(`ComfyUI rejected the workflow: ${summariseNodeErrors(r.node_errors)}`, r.node_errors);
  }
  return r.prompt_id;
}

export function summariseNodeErrors(nodeErrors: unknown): string {
  try {
    const parts: string[] = [];
    for (const [nodeId, v] of Object.entries(nodeErrors as Record<string, { class_type?: string; errors?: Array<{ message: string; details?: string }> }>)) {
      for (const e of v.errors ?? []) parts.push(`${v.class_type ?? nodeId}: ${e.message}${e.details ? ` (${e.details})` : ""}`);
    }
    return parts.join("; ") || JSON.stringify(nodeErrors).slice(0, 300);
  } catch {
    return String(nodeErrors);
  }
}

/** Interrupt the running prompt. With a prompt_id ComfyUI only interrupts if that prompt is the one running. */
export async function interrupt(base: string, promptId?: string): Promise<void> {
  await http(base, "/interrupt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(promptId ? { prompt_id: promptId } : {}),
    timeoutMs: 5000,
  });
}

export async function deleteFromQueue(base: string, promptId: string): Promise<void> {
  await http(base, "/queue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ delete: [promptId] }),
    timeoutMs: 5000,
  });
}

interface HistoryEntry {
  outputs: Record<string, Record<string, unknown>>;
  status?: { status_str: string; completed: boolean; messages?: unknown[] };
}

export async function getHistory(base: string, promptId: string): Promise<HistoryEntry | null> {
  const r = await http<Record<string, HistoryEntry>>(base, `/history/${promptId}`, { timeoutMs: 10000 });
  return r[promptId] ?? null;
}

/** Flatten a history entry's outputs into files (images, videos from SaveVideo, gifs from VHS). */
export function collectOutputFiles(entry: HistoryEntry): ComfyOutputFile[] {
  const files: ComfyOutputFile[] = [];
  for (const [nodeId, out] of Object.entries(entry.outputs ?? {})) {
    for (const key of ["images", "gifs", "videos", "audio"]) {
      const arr = out[key];
      if (!Array.isArray(arr)) continue;
      for (const f of arr as Array<{ filename: string; subfolder?: string; type?: string; format?: string }>) {
        if (!f?.filename) continue;
        files.push({ filename: f.filename, subfolder: f.subfolder ?? "", type: f.type ?? "output", format: f.format, nodeId });
      }
    }
  }
  return files;
}

export interface RunOptions {
  onProgress?: (p: ComfyProgress) => void;
  onQueued?: (promptId: string) => void;
  signal?: AbortSignal;
  /** Overall timeout; a 1024px SDXL image on an M1 can take 1-3 minutes, video much longer */
  timeoutMs?: number;
}

/**
 * Queue a workflow and wait for completion, reporting progress over the WebSocket.
 * Falls back to polling /history when the socket cannot be opened or drops.
 */
export async function runWorkflow(base: string, workflow: ApiWorkflow, opts: RunOptions = {}): Promise<{ promptId: string; files: ComfyOutputFile[] }> {
  const clientId = `local-imagine-${Math.random().toString(36).slice(2)}`;
  const wsUrl = joinUrl(base.replace(/^http/, "ws"), `/ws?clientId=${clientId}`);
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;

  let ws: WebSocket | null = null;
  let promptId = "";
  let submitted = false;
  let finished = false;

  const result = await new Promise<{ promptId: string }>((resolve, reject) => {
    let pollTimer: NodeJS.Timeout | null = null;
    let pollFailures = 0;
    let pollsWithoutEntry = 0;

    const cleanup = () => {
      clearTimeout(timer);
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      opts.signal?.removeEventListener("abort", onAbort);
      if (ws) {
        // Closing a CONNECTING socket emits 'error'; detach listeners first so nothing re-submits.
        ws.removeAllListeners();
        ws.on("error", () => undefined);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
    const done = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ promptId });
    };
    const fail = (err: Error, stopRemote = false) => {
      if (finished) return;
      finished = true;
      if (stopRemote && promptId) {
        interrupt(base, promptId).catch(() => undefined);
        deleteFromQueue(base, promptId).catch(() => undefined);
      }
      cleanup();
      reject(err);
    };
    const onAbort = () => fail(new ComfyError("Generation cancelled"), true);
    const timer = setTimeout(() => fail(new ComfyError("ComfyUI generation timed out"), true), timeoutMs);
    opts.signal?.addEventListener("abort", onAbort);

    const startPolling = () => {
      if (pollTimer || finished) return;
      pollTimer = setInterval(async () => {
        if (!promptId || finished) return;
        try {
          const h = await getHistory(base, promptId);
          pollFailures = 0;
          if (h?.status?.completed) return done();
          if (h?.status && h.status.status_str === "error") return fail(new ComfyError("ComfyUI reported an execution error", h.status.messages));
          if (!h) {
            // No history yet: make sure the prompt is still known to ComfyUI (it may have restarted).
            if (++pollsWithoutEntry % 5 === 0) {
              const q = await http<{ queue_running: unknown[][]; queue_pending: unknown[][] }>(base, "/queue", { timeoutMs: 5000 });
              const known = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])].some((item) => item?.[1] === promptId);
              if (!known) return fail(new ComfyError("ComfyUI lost the job (was it restarted?)"));
            }
          }
        } catch {
          // ComfyUI unreachable for a while: give up instead of waiting for the 30 minute timeout.
          if (++pollFailures >= 6) fail(new ComfyError("Lost connection to ComfyUI during generation"));
        }
      }, 1500);
    };

    const submit = async () => {
      if (submitted || finished) return;
      submitted = true;
      try {
        const id = await queuePrompt(base, workflow, clientId);
        if (finished) {
          // Cancelled while the POST was in flight: do not leave an orphan job behind.
          interrupt(base, id).catch(() => undefined);
          deleteFromQueue(base, id).catch(() => undefined);
          return;
        }
        promptId = id;
        opts.onQueued?.(promptId);
        // Always poll as a safety net (e.g. the prompt completed before the socket caught up).
        startPolling();
      } catch (err) {
        fail(err instanceof Error ? err : new ComfyError(String(err)));
      }
    };

    try {
      ws = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
    } catch {
      ws = null;
    }
    if (!ws) {
      void submit();
      return;
    }
    ws.on("open", () => void submit());
    ws.on("error", () => {
      // Socket unusable: keep going with polling only.
      if (!finished) void submit();
    });
    ws.on("close", () => {
      if (!finished && submitted) startPolling();
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary || finished) return; // preview image frames
      let msg: { type: string; data: Record<string, unknown> };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const d = msg.data ?? {};
      if (d.prompt_id && d.prompt_id !== promptId) return;
      switch (msg.type) {
        case "progress":
          opts.onProgress?.({ value: Number(d.value), max: Number(d.max), node: d.node ? String(d.node) : undefined });
          break;
        case "execution_error":
          fail(new ComfyError(`ComfyUI error in ${String(d.node_type ?? d.node_id)}: ${String(d.exception_message ?? "unknown")}`, d));
          break;
        case "execution_interrupted":
          fail(new ComfyError("Generation interrupted"));
          break;
        case "execution_success":
          // Sent before the history entry is written; the executing{node:null} sentinel follows.
          // Finish on the sentinel, or shortly after as a fallback for servers that skip it.
          setTimeout(done, 800);
          break;
        case "executing":
          // node === null is the completion sentinel (sent after history is written)
          if (d.node === null && promptId) done();
          break;
        default:
          break;
      }
    });
  });

  // Outputs are only in /history once the prompt is complete; the entry can lag the socket events slightly.
  let entry: HistoryEntry | null = null;
  for (let i = 0; i < 20; i++) {
    entry = await getHistory(base, result.promptId);
    if (entry && Object.keys(entry.outputs ?? {}).length > 0) break;
    if (entry?.status?.completed && entry.status.status_str !== "success") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!entry) throw new ComfyError("ComfyUI finished but no history entry was found");
  return { promptId: result.promptId, files: collectOutputFiles(entry) };
}
