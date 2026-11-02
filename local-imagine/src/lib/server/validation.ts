import { z } from "zod";
import { ASPECT_RATIOS, Settings } from "@/lib/types";

const url = z.string().trim().refine((v) => {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}, "http(s) URL required");

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const num = (min: number, max: number) => z.coerce.number().min(min).max(max);

export const settingsPatchSchema = z
  .object({
    ollamaUrl: url,
    comfyUrl: url,
    llmModel: z.string().max(200),
    visionModel: z.string().max(200),
    checkpoint: z.string().max(300),
    defaults: z
      .object({
        width: int(64, 4096),
        height: int(64, 4096),
        steps: int(1, 150),
        cfg: num(0, 30),
        sampler: z.string().max(60),
        scheduler: z.string().max(60),
        batchCount: int(1, 8),
        ipAdapterWeight: num(0, 2),
        clipSkip: int(0, 12),
      })
      .partial(),
    fastMode: z.boolean(),
    fastLora: z.string().max(300),
    fastSteps: int(1, 20),
    nsfwAllowed: z.boolean(),
    promptStyle: z.enum(["auto", "tags", "natural"]),
    historyLimit: int(1, 200),
    language: z.enum(["ja", "en", "auto"]),
    temperature: num(0, 2),
    llmKeepAlive: z.string().trim().regex(/^(-?\d+|\d+(\.\d+)?(ms|s|m|h))$/, 'use e.g. "0", "5m", "1h"'),
    llmNumCtx: int(1024, 262144),
    video: z
      .object({
        enabled: z.boolean(),
        preset: z.enum(["wan22-ti2v-5b", "animatediff-sd15"]),
        unetName: z.string().max(300),
        clipName: z.string().max(300),
        vaeName: z.string().max(300),
        frames: int(1, 241),
        fps: int(1, 60),
        width: int(64, 2048),
        height: int(64, 2048),
        steps: int(1, 100),
        cfg: num(0, 30),
        sd15Checkpoint: z.string().max(300),
        motionModule: z.string().max(300),
      })
      .partial(),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export function parseSettingsPatch(body: unknown): { ok: true; data: Partial<Settings> } | { ok: false; error: string } {
  const r = settingsPatchSchema.safeParse(body);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, data: r.data as Partial<Settings> };
}

const loraSchema = z.object({ name: z.string().min(1).max(300), strength: num(-2, 2) });

/** Fields a client may override for a direct generation (variations, retry, video). */
export const directParamsSchema = z
  .object({
    checkpoint: z.string().max(300),
    width: int(64, 4096),
    height: int(64, 4096),
    steps: int(1, 150),
    cfg: num(0, 30),
    sampler: z.string().max(60),
    scheduler: z.string().max(60),
    seed: z.coerce.number().int().min(-1).max(2 ** 53),
    batchCount: int(1, 8),
    loras: z.array(loraSchema).max(8),
    referenceImages: z.array(z.string().max(300)).max(8),
    ipAdapterWeight: num(0, 2),
    clipSkip: int(0, 12),
    mode: z.enum(["txt2img", "img2img", "video"]),
    initImage: z.string().max(300),
    denoise: num(0, 1),
    aspect: z.enum(ASPECT_RATIOS as [string, ...string[]]),
  })
  .partial()
  .strict();

export const directGenerateSchema = z.object({
  chatId: z.string(),
  prompt: z.string().trim().min(1).max(4000),
  negativePrompt: z.string().max(4000).optional(),
  params: directParamsSchema.optional(),
  compose: z.boolean().optional(),
  note: z.string().max(500).optional(),
});

export const chatMessageSchema = z.object({
  content: z.string().max(8000),
  attachments: z.array(z.string().max(300)).max(8).optional(),
});

const IMAGE_FILE = /^(uploads|images|personas)\/[a-z]_[a-z0-9]{8,40}(\/refs)?\/[A-Za-z0-9_.-]+\.(png|jpe?g|webp|gif)$/;

/** Data-relative image path produced by this app (no traversal, known folders, image extension). */
export function isAppImagePath(p: unknown): p is string {
  return typeof p === "string" && IMAGE_FILE.test(p) && !p.includes("..");
}

export const ALLOWED_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 10;

/** Sniff magic bytes so a renamed non-image is rejected. Returns the canonical extension or null. */
export function sniffImageExt(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return ".png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return ".webp";
  if (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a") return ".gif";
  return null;
}
