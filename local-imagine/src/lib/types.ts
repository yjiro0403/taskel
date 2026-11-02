/**
 * Shared domain types for Local Imagine.
 * Everything here is serialisable to JSON because the server persists it as JSON files.
 */

export type AspectRatio = "1:1" | "3:4" | "4:3" | "2:3" | "3:2" | "9:16" | "16:9";

export const ASPECT_RATIOS: AspectRatio[] = ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"];

export type GenerationMode = "txt2img" | "img2img" | "video";

export interface LoraRef {
  /** File name as listed by ComfyUI (e.g. "my_character.safetensors") */
  name: string;
  /** 0..2, applied to both model and clip */
  strength: number;
}

export interface GenParams {
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  /** -1 means "pick a random seed per image" */
  seed: number;
  /** Number of images to produce for this batch (each is queued separately so progress is incremental) */
  batchCount: number;
  loras: LoraRef[];
  /** Data-relative paths (e.g. "personas/<id>/refs/a.png") fed to IP-Adapter */
  referenceImages: string[];
  /** 0..1.5 IP-Adapter weight; ignored when no reference images */
  ipAdapterWeight: number;
  /** CLIP skip (1 = none, 2 = "clip skip 2" as used by Pony / SD1.5 anime models) */
  clipSkip: number;
  mode: GenerationMode;
  /** img2img: data-relative path of the source image */
  initImage?: string;
  /** img2img: 0..1, how much to change the init image */
  denoise?: number;
  /** video: number of frames and frame rate */
  videoFrames?: number;
  videoFps?: number;
}

export interface GeneratedImage {
  id: string;
  /** Data-relative path, served from /api/files/<file> */
  file: string;
  width: number;
  height: number;
  seed: number;
  kind: "image" | "video";
  /** ComfyUI prompt id, useful for debugging */
  promptId?: string;
}

export type BatchStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface GenerationBatch {
  id: string;
  /** Final composed prompt sent to ComfyUI */
  prompt: string;
  negativePrompt: string;
  /** What the LLM actually wrote (scene only); fed back as history so the model sees its own format */
  scenePrompt?: string;
  sceneNegative?: string;
  aspect?: AspectRatio;
  params: GenParams;
  images: GeneratedImage[];
  status: BatchStatus;
  error?: string;
  createdAt: string;
  durationMs?: number;
}

export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** Data-relative paths of images the user attached */
  attachments?: string[];
  generations?: GenerationBatch[];
  createdAt: string;
  /** LLM model that produced an assistant message */
  model?: string;
  /** Set when the LLM step itself failed */
  error?: string;
}

export interface Persona {
  id: string;
  /** Display name, e.g. "Aoi" */
  name: string;
  /** Free text character sheet shown to the LLM (personality, background, what they like to wear...) */
  description: string;
  /** Prompt fragment that pins the visual identity (hair, eyes, body, age "adult", signature outfit) */
  appearance: string;
  /** Prompt fragment for art style (e.g. "anime, flat shading" or "photorealistic, 85mm") */
  style: string;
  negativePrompt: string;
  /** Data-relative paths under personas/<id>/refs */
  referenceImages: string[];
  lora?: LoraRef;
  /** Trigger words that activate the LoRA, prepended to the prompt */
  triggerWords: string;
  /** Per-persona checkpoint override */
  checkpoint?: string;
  /** Whether adult content is allowed in this persona's chats (also gated by Settings.nsfwAllowed) */
  nsfw: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Chat {
  id: string;
  personaId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface ChatSummary {
  id: string;
  personaId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  imageCount: number;
  /** Most recent generated image, for the sidebar thumbnail */
  lastImage?: string;
}

export type PromptStyle = "auto" | "tags" | "natural";

export interface GenerationDefaults {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  batchCount: number;
  ipAdapterWeight: number;
  /** 0 = auto (2 for Pony / SD1.5 anime, 1 otherwise) */
  clipSkip: number;
}

export interface VideoSettings {
  enabled: boolean;
  /** Preset identifier, see src/lib/server/workflows.ts */
  preset: "wan22-ti2v-5b" | "animatediff-sd15";
  /** Model file names as they appear in ComfyUI's models folders */
  unetName: string;
  clipName: string;
  vaeName: string;
  frames: number;
  fps: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  /** AnimateDiff only: SD1.5 checkpoint + motion module */
  sd15Checkpoint: string;
  motionModule: string;
}

export interface Settings {
  ollamaUrl: string;
  comfyUrl: string;
  /** Ollama model used for the chat agent */
  llmModel: string;
  /** Ollama vision model used to describe attached/reference images ("" = disabled) */
  visionModel: string;
  /** Default ComfyUI checkpoint */
  checkpoint: string;
  defaults: GenerationDefaults;
  /** Global switch; a persona must also opt in */
  nsfwAllowed: boolean;
  promptStyle: PromptStyle;
  /** Max previous messages sent to the LLM */
  historyLimit: number;
  /** Language the assistant should reply in */
  language: "ja" | "en" | "auto";
  video: VideoSettings;
  /**
   * Fast mode: apply an SDXL-Lightning / Hyper-SD LoRA and sample `fastSteps` (default 8) steps at CFG 1.5
   * (euler + sgm_uniform). Roughly 4-6x faster per image on an M1.
   */
  fastMode: boolean;
  /** LoRA file (models/loras) used by fast mode, e.g. "sdxl_lightning_8step_lora.safetensors" */
  fastLora: string;
  fastSteps: number;
  /** Temperature passed to Ollama */
  temperature: number;
  /**
   * Ollama keep_alive for the chat model. "0" unloads the LLM right after each reply so the
   * unified memory is free for ComfyUI (recommended on 8GB Macs); "5m" keeps it warm.
   */
  llmKeepAlive: string;
  /** Context window passed as options.num_ctx (Ollama defaults to 4096 on <24GB Macs) */
  llmNumCtx: number;
}

export interface ImageModelCatalog {
  checkpoints: string[];
  loras: string[];
  vaes: string[];
  samplers: string[];
  schedulers: string[];
  unets: string[];
  clips: string[];
  /** ComfyUI_IPAdapter_plus nodes present */
  hasIPAdapter: boolean;
  /** Option strings of IPAdapterUnifiedLoader.preset (used to pick a valid preset at runtime) */
  ipAdapterPresets: string[];
  /** Files present in models/ipadapter (from IPAdapterModelLoader) so we only pick presets whose weights exist */
  ipAdapterFiles: string[];
  /** Option strings of IPAdapterAdvanced.weight_type / combine_embeds / embeds_scaling */
  ipAdapterWeightTypes: string[];
  ipAdapterCombineEmbeds: string[];
  ipAdapterEmbedsScaling: string[];
  /** Wan 2.2 / core video nodes present */
  hasWanVideo: boolean;
  /** ComfyUI-AnimateDiff-Evolved + VideoHelperSuite present */
  hasAnimateDiff: boolean;
  fetchedAt: string;
}

export interface LlmModelInfo {
  name: string;
  size: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
  modifiedAt?: string;
}

export interface HealthStatus {
  ollama: { ok: boolean; error?: string; version?: string };
  comfy: { ok: boolean; error?: string; device?: string; vramTotal?: number; vramFree?: number; pythonVersion?: string };
  dataDir: string;
}

/** Events streamed over SSE from /api/chats/[id]/messages and /api/generate */
export type StreamEvent =
  | { type: "user_message"; message: Message }
  | { type: "assistant_message"; message: Message }
  | { type: "batch_start"; messageId: string; batch: GenerationBatch }
  | { type: "progress"; messageId: string; batchId: string; value: number; max: number; imageIndex: number; node?: string }
  | { type: "image"; messageId: string; batchId: string; image: GeneratedImage }
  | { type: "batch_end"; messageId: string; batch: GenerationBatch }
  | { type: "status"; text: string }
  | { type: "error"; error: string; messageId?: string }
  | { type: "done"; messageId?: string };

/** What the LLM must return (Ollama structured output). */
export interface AgentPlan {
  reply: string;
  generations: Array<{
    prompt: string;
    negative_prompt: string;
    count: number;
    aspect: AspectRatio;
    use_reference_images: boolean;
  }>;
}

export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
  comfyUrl: process.env.COMFYUI_URL || "http://127.0.0.1:8188",
  llmModel: "",
  visionModel: "",
  checkpoint: "",
  defaults: {
    width: 832,
    height: 1216,
    steps: 25,
    cfg: 6,
    sampler: "euler_ancestral",
    scheduler: "normal",
    batchCount: 2,
    ipAdapterWeight: 0.7,
    clipSkip: 0,
  },
  fastMode: false,
  fastLora: "",
  fastSteps: 8,
  nsfwAllowed: false,
  promptStyle: "auto",
  historyLimit: 20,
  language: "auto",
  temperature: 0.8,
  llmKeepAlive: "5m",
  llmNumCtx: 8192,
  video: {
    enabled: false,
    // AnimateDiff on SD1.5 is the only video path that is realistic on an 8-16GB M1.
    preset: "animatediff-sd15",
    unetName: "wan2.2_ti2v_5B_fp16.safetensors",
    // fp8 text encoders do not load on MPS; use the fp16 file on a Mac.
    clipName: "umt5_xxl_fp16.safetensors",
    vaeName: "wan2.2_vae.safetensors",
    frames: 16,
    fps: 8,
    width: 512,
    height: 512,
    steps: 20,
    cfg: 7,
    sd15Checkpoint: "",
    motionModule: "mm_sd_v15_v2.ckpt",
  },
};

/** Map an aspect ratio to SDXL-friendly dimensions (multiples of 64, ~1MP) or SD1.5 (~0.3MP). */
export function dimensionsForAspect(aspect: AspectRatio, family: "sd15" | "sdxl" | "flux"): { width: number; height: number } {
  const sdxl: Record<AspectRatio, [number, number]> = {
    "1:1": [1024, 1024],
    "3:4": [896, 1152],
    "4:3": [1152, 896],
    "2:3": [832, 1216],
    "3:2": [1216, 832],
    "9:16": [768, 1344],
    "16:9": [1344, 768],
  };
  const sd15: Record<AspectRatio, [number, number]> = {
    "1:1": [512, 512],
    "3:4": [512, 704],
    "4:3": [704, 512],
    "2:3": [512, 768],
    "3:2": [768, 512],
    "9:16": [448, 768],
    "16:9": [768, 448],
  };
  const [w, h] = family === "sd15" ? sd15[aspect] : sdxl[aspect];
  return { width: w, height: h };
}

export type CheckpointFamily = "sd15" | "sdxl" | "pony" | "illustrious" | "flux" | "unknown";

/** Guess the model family from a checkpoint file name so the agent can pick a prompt style. */
export function guessCheckpointFamily(name: string): CheckpointFamily {
  const n = name.toLowerCase();
  if (/pony/.test(n)) return "pony";
  if (/illustrious|noob|wai|animagine|hassaku|ntr|plant/.test(n)) return "illustrious";
  if (/flux|chroma/.test(n)) return "flux";
  if (/xl|sdxl|juggernaut|dreamshaperxl|realvisxl|cyberrealisticxl|turbo|lightning/.test(n)) return "sdxl";
  if (/v1-5|sd15|1\.5|realistic_?vision|anything|counterfeit|meina|dreamshaper_8|majic|chillout|abyss/.test(n)) return "sd15";
  return "unknown";
}

export function baseFamily(family: CheckpointFamily): "sd15" | "sdxl" | "flux" {
  if (family === "sd15") return "sd15";
  if (family === "flux") return "flux";
  return "sdxl";
}

/** Ids generated by newId(): prefix + base36 time + hex. Reject anything else at the API boundary. */
export const ID_PATTERN = /^[a-z]_[a-z0-9]{8,40}$/;
export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_PATTERN.test(id);
}
