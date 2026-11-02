import path from "path";
import {
  AspectRatio,
  GenParams,
  GenerationBatch,
  GeneratedImage,
  Persona,
  Settings,
  StreamEvent,
  baseFamily,
  dimensionsForAspect,
  guessCheckpointFamily,
} from "@/lib/types";
import { newId, nowIso, randomSeed } from "@/lib/ids";
import * as comfy from "./comfy";
import { buildAnimateDiffWorkflow, buildImageWorkflow, buildWanVideoWorkflow } from "./workflows";
import { mutateChat, readBinary, saveBinary } from "./store";
import { markBatchActive } from "./jobs";

/**
 * Turns a GenerationBatch into files on disk, streaming progress events.
 * Each image is queued as its own ComfyUI prompt so the UI can show them one by one
 * and so an 8GB M1 never has to hold a batch of latents at once.
 */

export interface RunBatchContext {
  chatId: string;
  messageId: string;
  settings: Settings;
  persona: Persona | null;
  send: (e: StreamEvent) => void;
  signal?: AbortSignal;
}

/** Build GenParams from settings + persona + the agent's choice of aspect ratio. */
export function resolveParams(
  settings: Settings,
  persona: Persona | null,
  opts: { aspect?: AspectRatio; count?: number; referenceImages?: string[]; mode?: GenParams["mode"]; initImage?: string; denoise?: number; seed?: number },
): GenParams {
  const checkpoint = persona?.checkpoint || settings.checkpoint;
  const family = guessCheckpointFamily(checkpoint);
  const base = baseFamily(family);
  const dims = opts.aspect ? dimensionsForAspect(opts.aspect, base) : { width: settings.defaults.width, height: settings.defaults.height };
  const d = settings.defaults;
  const params: GenParams = {
    checkpoint,
    width: dims.width,
    height: dims.height,
    steps: d.steps,
    cfg: d.cfg,
    sampler: d.sampler,
    scheduler: d.scheduler,
    seed: opts.seed ?? -1,
    batchCount: Math.min(8, Math.max(1, opts.count ?? d.batchCount)),
    loras: persona?.lora?.name ? [persona.lora] : [],
    referenceImages: opts.referenceImages ?? [],
    ipAdapterWeight: d.ipAdapterWeight,
    clipSkip: d.clipSkip > 0 ? d.clipSkip : family === "pony" || family === "sd15" ? 2 : 1,
    mode: opts.mode ?? "txt2img",
    initImage: opts.initImage,
    denoise: opts.denoise,
  };
  if (family === "flux") {
    // Flux checkpoints need cfg 1 (no negative) and like euler/simple
    params.cfg = 1;
    params.sampler = "euler";
    params.scheduler = "simple";
    params.steps = Math.min(params.steps, /schnell/i.test(checkpoint) ? 4 : 20);
  }
  if (/turbo|lightning|hyper/i.test(checkpoint)) {
    params.steps = Math.min(params.steps, 8);
    params.cfg = Math.min(params.cfg, 2);
    params.scheduler = "sgm_uniform";
  }
  if (settings.fastMode && settings.fastLora && base === "sdxl" && family !== "flux") {
    // SDXL-Lightning / Hyper-SD: euler + sgm_uniform, few steps, CFG ~1-2
    params.loras = [...params.loras, { name: settings.fastLora, strength: 1 }];
    params.steps = Math.max(2, settings.fastSteps || 8);
    params.cfg = 1.5;
    params.sampler = "euler";
    params.scheduler = "sgm_uniform";
  }
  return params;
}

async function uploadRef(settings: Settings, rel: string): Promise<string> {
  const data = await readBinary(rel);
  const name = rel.replace(/[\\/]/g, "_");
  const up = await comfy.uploadImage(settings.comfyUrl, data, name);
  return comfy.loadImageRef(up);
}

function extFor(file: comfy.ComfyOutputFile): string {
  const ext = path.extname(file.filename).toLowerCase();
  return ext || (file.format?.includes("mp4") ? ".mp4" : ".png");
}

export async function runBatch(ctx: RunBatchContext, batch: GenerationBatch): Promise<GenerationBatch> {
  const { settings, send, signal, chatId, messageId } = ctx;
  const started = Date.now();
  const update = async (patch: Partial<GenerationBatch>) => {
    Object.assign(batch, patch);
    const chat = await mutateChat(chatId, (c) => {
      const m = c.messages.find((x) => x.id === messageId);
      const g = m?.generations?.find((x) => x.id === batch.id);
      if (g) Object.assign(g, patch);
    });
    // The chat was deleted while we were rendering: stop instead of recreating its folder.
    if (!chat) throw new comfy.ComfyError("Chat was deleted during generation");
  };

  markBatchActive(batch.id, true);
  try {
    await update({ status: "running" });
  } catch (err) {
    markBatchActive(batch.id, false);
    batch.status = "error";
    batch.error = (err as Error).message;
    send({ type: "batch_end", messageId, batch });
    return batch;
  }
  send({ type: "batch_start", messageId, batch });

  try {
    if (!batch.params.checkpoint && batch.params.mode !== "video") {
      throw new comfy.ComfyError("No checkpoint selected. Pick one in the top bar (ComfyUI models/checkpoints).");
    }
    const catalog = await comfy.getImageModelCatalog(settings.comfyUrl);

    // Upload references / init image once per batch
    const referenceInputs: string[] = [];
    for (const rel of batch.params.referenceImages) {
      try {
        referenceInputs.push(await uploadRef(settings, rel));
      } catch (err) {
        send({ type: "status", text: `参照画像のアップロードに失敗: ${rel} (${(err as Error).message})` });
      }
    }
    const initInput = batch.params.initImage ? await uploadRef(settings, batch.params.initImage) : undefined;
    if (referenceInputs.length && !catalog.hasIPAdapter) {
      send({ type: "status", text: "ComfyUI に IP-Adapter ノードが無いため、参照画像は無視して生成します。" });
    }

    const total = batch.params.mode === "video" ? 1 : batch.params.batchCount;
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new comfy.ComfyError("Generation cancelled");
      const seed = batch.params.seed === -1 ? randomSeed() : batch.params.seed + i;
      const prefix = `local-imagine/${chatId}/${batch.id}`;

      let workflow: comfy.ApiWorkflow;
      if (batch.params.mode === "video") {
        const v = settings.video;
        if (v.preset === "animatediff-sd15") {
          if (!catalog.hasAnimateDiff) throw new comfy.ComfyError("AnimateDiff-Evolved / VideoHelperSuite nodes are not installed in ComfyUI.");
          workflow = buildAnimateDiffWorkflow({
            video: v,
            prompt: batch.prompt,
            negativePrompt: batch.negativePrompt,
            seed,
            filenamePrefix: prefix,
            checkpoint: v.sd15Checkpoint || batch.params.checkpoint,
            sampler: batch.params.sampler,
            scheduler: batch.params.scheduler,
          });
        } else {
          if (!catalog.hasWanVideo) throw new comfy.ComfyError("Wan 2.2 video nodes are not available. Update ComfyUI to a 2025-08+ version.");
          workflow = buildWanVideoWorkflow({
            video: v,
            prompt: batch.prompt,
            negativePrompt: batch.negativePrompt,
            seed,
            startImageInput: initInput,
            filenamePrefix: prefix,
          });
        }
      } else {
        workflow = buildImageWorkflow({
          params: batch.params,
          prompt: batch.prompt,
          negativePrompt: batch.negativePrompt,
          seed,
          referenceInputs,
          initInput,
          filenamePrefix: prefix,
          catalog,
        });
      }

      const { promptId, files } = await comfy.runWorkflow(settings.comfyUrl, workflow, {
        signal,
        onProgress: (p) => send({ type: "progress", messageId, batchId: batch.id, value: p.value, max: p.max, imageIndex: i, node: p.node }),
      });

      const outputs = files.filter((f) => f.type === "output");
      if (!outputs.length) throw new comfy.ComfyError("ComfyUI finished without producing an output file", files);

      for (const f of outputs) {
        const data = await comfy.fetchOutput(settings.comfyUrl, f);
        const ext = extFor(f);
        const kind: GeneratedImage["kind"] = [".mp4", ".webm", ".gif", ".webp"].includes(ext) && batch.params.mode === "video" ? "video" : "image";
        const rel = `images/${chatId}/${batch.id}_${i}_${seed}${ext}`;
        await saveBinary(rel, data);
        const image: GeneratedImage = {
          id: newId("i_"),
          file: rel,
          width: batch.params.mode === "video" ? settings.video.width : batch.params.width,
          height: batch.params.mode === "video" ? settings.video.height : batch.params.height,
          seed,
          kind,
          promptId,
        };
        batch.images.push(image);
        await update({ images: batch.images });
        send({ type: "image", messageId, batchId: batch.id, image });
      }
    }
    await update({ status: "done", durationMs: Date.now() - started });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await update({ status: signal?.aborted ? "cancelled" : "error", error: msg, durationMs: Date.now() - started });
    } catch {
      Object.assign(batch, { status: "error", error: msg });
    }
  } finally {
    markBatchActive(batch.id, false);
  }
  send({ type: "batch_end", messageId, batch });
  return batch;
}

export function newBatch(prompt: string, negativePrompt: string, params: GenParams): GenerationBatch {
  return { id: newId("g_"), prompt, negativePrompt, params, images: [], status: "queued", createdAt: nowIso() };
}
