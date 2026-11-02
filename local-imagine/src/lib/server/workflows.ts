import { ApiWorkflow } from "./comfy";
import { GenParams, ImageModelCatalog, VideoSettings, baseFamily, guessCheckpointFamily } from "@/lib/types";

/**
 * Builders that turn our GenParams into ComfyUI API-format workflows.
 * Node ids are strings; links are [nodeId, outputIndex].
 *
 * Output indexes used:
 *   CheckpointLoaderSimple -> 0 MODEL, 1 CLIP, 2 VAE
 *   LoraLoader             -> 0 MODEL, 1 CLIP
 *   CLIPSetLastLayer       -> 0 CLIP
 *   CLIPTextEncode         -> 0 CONDITIONING
 *   EmptyLatentImage/VAEEncode/KSampler -> 0 LATENT
 *   LoadImage              -> 0 IMAGE, 1 MASK
 *   VAEDecode              -> 0 IMAGE
 *   IPAdapterUnifiedLoader -> 0 MODEL, 1 IPADAPTER
 *   IPAdapterAdvanced      -> 0 MODEL
 *   ImageBatch             -> 0 IMAGE
 */

/** Pick the first preferred option that the installed node actually offers (falls back to the node's first option). */
export function pickOption(available: string[], preferred: string[], fallback: string): string {
  for (const want of preferred) {
    const hit = available.find((o) => o.toLowerCase().includes(want.toLowerCase()));
    if (hit) return hit;
  }
  return available[0] ?? fallback;
}

type Link = [string, number];

class WorkflowBuilder {
  private nodes: ApiWorkflow = {};
  private counter = 0;

  add(classType: string, inputs: Record<string, unknown>, title?: string): string {
    const id = String(++this.counter);
    this.nodes[id] = { class_type: classType, inputs, _meta: title ? { title } : undefined };
    return id;
  }

  build(): ApiWorkflow {
    return this.nodes;
  }
}

export interface ImageWorkflowInput {
  params: GenParams;
  prompt: string;
  negativePrompt: string;
  seed: number;
  /** ComfyUI input-folder references ("subfolder/name.png") for reference images */
  referenceInputs: string[];
  /** ComfyUI input-folder reference for the img2img source */
  initInput?: string;
  filenamePrefix: string;
  /** Node catalog from /object_info; IP-Adapter is only wired in when its nodes exist */
  catalog: Pick<ImageModelCatalog, "hasIPAdapter" | "ipAdapterPresets" | "ipAdapterFiles" | "ipAdapterWeightTypes" | "ipAdapterCombineEmbeds" | "ipAdapterEmbedsScaling">;
}

/**
 * Choose an IPAdapterUnifiedLoader preset whose weight file is actually installed.
 * SDXL: ip-adapter-plus-face_sdxl_vit-h -> "PLUS FACE", ip-adapter-plus_sdxl_vit-h -> "PLUS", ip-adapter_sdxl_vit-h -> "STANDARD".
 * SD1.5: ip-adapter-plus-face_sd15 -> "PLUS FACE", ip-adapter-plus_sd15 -> "PLUS", ip-adapter_sd15 -> "STANDARD".
 */
export function chooseIpAdapterPreset(catalog: ImageWorkflowInput["catalog"], checkpoint: string): string {
  const family = baseFamily(guessCheckpointFamily(checkpoint));
  const files = catalog.ipAdapterFiles.map((f) => f.toLowerCase());
  const has = (re: RegExp) => files.some((f) => re.test(f));
  const sdxl = family === "sdxl";
  const candidates: Array<[RegExp, string[]]> = sdxl
    ? [
        [/plus-face_sdxl/, ["PLUS FACE"]],
        [/plus_sdxl/, ["PLUS (high strength)", "PLUS"]],
        [/ip-adapter_sdxl_vit-h/, ["STANDARD"]],
        [/ip-adapter_sdxl\.safetensors/, ["VIT-G"]],
      ]
    : [
        [/plus-face_sd15/, ["PLUS FACE"]],
        [/full-face_sd15/, ["FULL FACE"]],
        [/plus_sd15/, ["PLUS (high strength)", "PLUS"]],
        [/ip-adapter_sd15\.safetensors/, ["STANDARD"]],
        [/ip-adapter_sd15_light/, ["LIGHT"]],
      ];
  for (const [re, prefs] of candidates) {
    if (has(re)) return pickOption(catalog.ipAdapterPresets, prefs, prefs[0]);
  }
  // Unknown file layout: let the loader try PLUS FACE / PLUS and surface its own error.
  return pickOption(catalog.ipAdapterPresets, ["PLUS FACE", "PLUS (high strength)", "PLUS", "STANDARD"], "PLUS (high strength)");
}

/**
 * txt2img / img2img with optional LoRA chain and optional IP-Adapter (reference images).
 */
export function buildImageWorkflow(input: ImageWorkflowInput): ApiWorkflow {
  const { params, prompt, negativePrompt, seed, referenceInputs, initInput, filenamePrefix } = input;
  const b = new WorkflowBuilder();

  const ckpt = b.add("CheckpointLoaderSimple", { ckpt_name: params.checkpoint }, "Load Checkpoint");
  let model: Link = [ckpt, 0];
  let clip: Link = [ckpt, 1];
  const vae: Link = [ckpt, 2];

  for (const lora of params.loras.filter((l) => l.name && l.strength !== 0)) {
    const id = b.add(
      "LoraLoader",
      { model, clip, lora_name: lora.name, strength_model: lora.strength, strength_clip: lora.strength },
      `LoRA ${lora.name}`,
    );
    model = [id, 0];
    clip = [id, 1];
  }

  // IP-Adapter (ComfyUI_IPAdapter_plus): batch all reference images into one IMAGE tensor,
  // average their embeddings and apply with the "PLUS FACE" preset when available.
  if (input.catalog.hasIPAdapter && referenceInputs.length > 0) {
    let image: Link | null = null;
    for (const ref of referenceInputs) {
      const load = b.add("LoadImage", { image: ref }, "Reference image");
      image = image ? [b.add("ImageBatch", { image1: image, image2: [load, 0] }), 0] : [load, 0];
    }
    const c = input.catalog;
    const preset = chooseIpAdapterPreset(c, params.checkpoint);
    const loader = b.add("IPAdapterUnifiedLoader", { model, preset }, "IPAdapter Unified Loader");
    const ipa = b.add(
      "IPAdapterAdvanced",
      {
        model: [loader, 0],
        ipadapter: [loader, 1],
        image,
        weight: params.ipAdapterWeight,
        weight_type: pickOption(c.ipAdapterWeightTypes, ["linear"], "linear"),
        combine_embeds: pickOption(c.ipAdapterCombineEmbeds, ["average", "concat"], "average"),
        start_at: 0,
        end_at: 0.9,
        embeds_scaling: pickOption(c.ipAdapterEmbedsScaling, ["V only"], "V only"),
      },
      "Apply IPAdapter",
    );
    model = [ipa, 0];
  }

  if (params.clipSkip && params.clipSkip > 1) {
    clip = [b.add("CLIPSetLastLayer", { clip, stop_at_clip_layer: -params.clipSkip }, `CLIP skip ${params.clipSkip}`), 0];
  }

  const pos = b.add("CLIPTextEncode", { text: prompt, clip }, "Positive");
  const neg = b.add("CLIPTextEncode", { text: negativePrompt, clip }, "Negative");

  let latent: Link;
  let denoise = 1;
  if (params.mode === "img2img" && initInput) {
    const load = b.add("LoadImage", { image: initInput }, "Init image");
    const enc = b.add("VAEEncode", { pixels: [load, 0], vae }, "VAE Encode");
    latent = [enc, 0];
    denoise = params.denoise ?? 0.6;
  } else {
    const empty = b.add("EmptyLatentImage", { width: params.width, height: params.height, batch_size: 1 }, "Empty Latent");
    latent = [empty, 0];
  }

  const sampler = b.add(
    "KSampler",
    {
      model,
      positive: [pos, 0],
      negative: [neg, 0],
      latent_image: latent,
      seed,
      steps: params.steps,
      cfg: params.cfg,
      sampler_name: params.sampler,
      scheduler: params.scheduler,
      denoise,
    },
    "KSampler",
  );
  const decode = b.add("VAEDecode", { samples: [sampler, 0], vae }, "VAE Decode");
  b.add("SaveImage", { images: [decode, 0], filename_prefix: filenamePrefix }, "Save Image");
  return b.build();
}

export interface VideoWorkflowInput {
  video: VideoSettings;
  prompt: string;
  negativePrompt: string;
  seed: number;
  /** Optional start frame for image-to-video */
  startImageInput?: string;
  filenamePrefix: string;
}

/**
 * Wan 2.2 TI2V 5B (text/image-to-video) using ComfyUI core nodes.
 * Mirrors the official "video_wan2_2_5B_ti2v" template:
 *   UNETLoader -> ModelSamplingSD3 -> KSampler(uni_pc/simple) -> VAEDecode -> CreateVideo -> SaveVideo
 * Requires models/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors, models/text_encoders/umt5_xxl_*.safetensors,
 * models/vae/wan2.2_vae.safetensors.
 */
export function buildWanVideoWorkflow(input: VideoWorkflowInput): ApiWorkflow {
  const { video, prompt, negativePrompt, seed, startImageInput, filenamePrefix } = input;
  const b = new WorkflowBuilder();
  const unet = b.add("UNETLoader", { unet_name: video.unetName, weight_dtype: "default" }, "Load Diffusion Model");
  const clip = b.add("CLIPLoader", { clip_name: video.clipName, type: "wan", device: "default" }, "Load CLIP");
  const vae = b.add("VAELoader", { vae_name: video.vaeName }, "Load VAE");
  const shifted = b.add("ModelSamplingSD3", { model: [unet, 0], shift: 8 }, "ModelSamplingSD3");
  const pos = b.add("CLIPTextEncode", { text: prompt, clip: [clip, 0] }, "Positive");
  const neg = b.add("CLIPTextEncode", { text: negativePrompt, clip: [clip, 0] }, "Negative");

  const latentInputs: Record<string, unknown> = {
    width: video.width,
    height: video.height,
    length: video.frames,
    batch_size: 1,
    vae: [vae, 0],
  };
  if (startImageInput) {
    const load = b.add("LoadImage", { image: startImageInput }, "Start image");
    latentInputs.start_image = [load, 0];
  }
  const latent = b.add("Wan22ImageToVideoLatent", latentInputs, "Wan 2.2 latent");

  const sampler = b.add(
    "KSampler",
    {
      model: [shifted, 0],
      positive: [pos, 0],
      negative: [neg, 0],
      latent_image: [latent, 0],
      seed,
      steps: video.steps,
      cfg: video.cfg,
      sampler_name: "uni_pc",
      scheduler: "simple",
      denoise: 1,
    },
    "KSampler",
  );
  const decode = b.add("VAEDecode", { samples: [sampler, 0], vae: [vae, 0] }, "VAE Decode");
  const vid = b.add("CreateVideo", { images: [decode, 0], fps: video.fps }, "Create Video");
  b.add("SaveVideo", { video: [vid, 0], filename_prefix: filenamePrefix, format: "mp4", codec: "h264" }, "Save Video");
  return b.build();
}

/**
 * AnimateDiff (SD1.5) via ComfyUI-AnimateDiff-Evolved + VideoHelperSuite.
 * Lighter than Wan; produces short looping clips at 512px. Needs:
 *   custom_nodes/ComfyUI-AnimateDiff-Evolved with models/animatediff_models/mm_sd_v15_v2.ckpt
 *   custom_nodes/ComfyUI-VideoHelperSuite
 */
export function buildAnimateDiffWorkflow(input: VideoWorkflowInput & { checkpoint: string; sampler: string; scheduler: string }): ApiWorkflow {
  const { video, prompt, negativePrompt, seed, filenamePrefix } = input;
  const b = new WorkflowBuilder();
  const ckpt = b.add("CheckpointLoaderSimple", { ckpt_name: input.checkpoint }, "Load Checkpoint (SD1.5)");
  const ad = b.add(
    "ADE_AnimateDiffLoaderGen1",
    { model: [ckpt, 0], model_name: video.motionModule, beta_schedule: "autoselect" },
    "AnimateDiff Loader",
  );
  const pos = b.add("CLIPTextEncode", { text: prompt, clip: [ckpt, 1] }, "Positive");
  const neg = b.add("CLIPTextEncode", { text: negativePrompt, clip: [ckpt, 1] }, "Negative");
  const latent = b.add("EmptyLatentImage", { width: video.width, height: video.height, batch_size: video.frames }, "Latent frames");
  const sampler = b.add(
    "KSampler",
    {
      model: [ad, 0],
      positive: [pos, 0],
      negative: [neg, 0],
      latent_image: [latent, 0],
      seed,
      steps: video.steps,
      cfg: video.cfg,
      sampler_name: input.sampler,
      scheduler: input.scheduler,
      denoise: 1,
    },
    "KSampler",
  );
  const decode = b.add("VAEDecode", { samples: [sampler, 0], vae: [ckpt, 2] }, "VAE Decode");
  b.add(
    "VHS_VideoCombine",
    {
      images: [decode, 0],
      frame_rate: video.fps,
      loop_count: 0,
      filename_prefix: filenamePrefix,
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf: 19,
      pingpong: false,
      save_output: true,
    },
    "Video Combine",
  );
  return b.build();
}
