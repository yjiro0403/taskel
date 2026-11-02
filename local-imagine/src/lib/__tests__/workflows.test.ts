import { describe, expect, it } from "vitest";
import { buildAnimateDiffWorkflow, buildImageWorkflow, buildWanVideoWorkflow, chooseIpAdapterPreset } from "@/lib/server/workflows";
import { DEFAULT_SETTINGS, GenParams } from "@/lib/types";

const params: GenParams = {
  checkpoint: "ponyDiffusionV6XL.safetensors",
  width: 832,
  height: 1216,
  steps: 25,
  cfg: 6,
  sampler: "euler_ancestral",
  scheduler: "normal",
  seed: -1,
  batchCount: 2,
  loras: [{ name: "aoi.safetensors", strength: 0.8 }],
  referenceImages: ["personas/p1/refs/a.png"],
  ipAdapterWeight: 0.7,
  clipSkip: 2,
  mode: "txt2img",
};

const catalog = {
  hasIPAdapter: true,
  ipAdapterPresets: ["STANDARD (medium strength)", "PLUS (high strength)", "PLUS FACE (portraits)"],
  ipAdapterFiles: ["ip-adapter-plus-face_sdxl_vit-h.safetensors", "ip-adapter-plus_sd15.safetensors"],
  ipAdapterWeightTypes: ["linear", "style transfer"],
  ipAdapterCombineEmbeds: ["concat", "average"],
  ipAdapterEmbedsScaling: ["V only", "K+V"],
};

const byClass = (wf: Record<string, { class_type: string; inputs: Record<string, unknown> }>, cls: string) =>
  Object.values(wf).filter((n) => n.class_type === cls);

describe("buildImageWorkflow", () => {
  it("builds a txt2img graph with LoRA chain and IP-Adapter", () => {
    const wf = buildImageWorkflow({
      params,
      prompt: "p",
      negativePrompt: "n",
      seed: 42,
      referenceInputs: ["local-imagine/a.png", "local-imagine/b.png"],
      filenamePrefix: "x",
      catalog,
    });
    expect(byClass(wf, "CheckpointLoaderSimple")).toHaveLength(1);
    expect(byClass(wf, "LoraLoader")).toHaveLength(1);
    expect(byClass(wf, "LoadImage")).toHaveLength(2);
    expect(byClass(wf, "ImageBatch")).toHaveLength(1);
    expect(byClass(wf, "IPAdapterUnifiedLoader")[0].inputs.preset).toBe("PLUS FACE (portraits)");
    const ipa = byClass(wf, "IPAdapterAdvanced")[0];
    expect(ipa.inputs.weight_type).toBe("linear");
    expect(ipa.inputs.combine_embeds).toBe("average");
    const ks = byClass(wf, "KSampler")[0];
    expect(ks.inputs.seed).toBe(42);
    expect(ks.inputs.denoise).toBe(1);
    // KSampler must take the IP-Adapter patched model
    const ipaId = Object.keys(wf).find((k) => wf[k].class_type === "IPAdapterAdvanced");
    expect(ks.inputs.model).toEqual([ipaId, 0]);
    expect(byClass(wf, "EmptyLatentImage")[0].inputs).toMatchObject({ width: 832, height: 1216, batch_size: 1 });
    expect(byClass(wf, "CLIPSetLastLayer")[0].inputs.stop_at_clip_layer).toBe(-2);
    // text encoders must use the clip-skipped CLIP
    const csId = Object.keys(wf).find((k) => wf[k].class_type === "CLIPSetLastLayer");
    expect(byClass(wf, "CLIPTextEncode")[0].inputs.clip).toEqual([csId, 0]);
    expect(byClass(wf, "SaveImage")).toHaveLength(1);
  });

  it("skips IP-Adapter when nodes are missing and does img2img with denoise", () => {
    const wf = buildImageWorkflow({
      params: { ...params, mode: "img2img", denoise: 0.55, loras: [], clipSkip: 1 },
      prompt: "p",
      negativePrompt: "n",
      seed: 1,
      referenceInputs: ["local-imagine/a.png"],
      initInput: "local-imagine/init.png",
      filenamePrefix: "x",
      catalog: { ...catalog, hasIPAdapter: false },
    });
    expect(byClass(wf, "IPAdapterAdvanced")).toHaveLength(0);
    expect(byClass(wf, "LoraLoader")).toHaveLength(0);
    expect(byClass(wf, "CLIPSetLastLayer")).toHaveLength(0);
    expect(byClass(wf, "VAEEncode")).toHaveLength(1);
    expect(byClass(wf, "KSampler")[0].inputs.denoise).toBe(0.55);
  });

  it("chooses presets by installed files and model family", () => {
    expect(chooseIpAdapterPreset(catalog, "ponyDiffusionV6XL.safetensors")).toBe("PLUS FACE (portraits)");
    expect(chooseIpAdapterPreset(catalog, "realisticVisionV60.safetensors")).toBe("PLUS (high strength)");
    expect(chooseIpAdapterPreset({ ...catalog, ipAdapterFiles: ["ip-adapter_sdxl_vit-h.safetensors"] }, "juggernautXL.safetensors")).toBe("STANDARD (medium strength)");
  });
});

describe("video workflows", () => {
  it("builds the Wan 2.2 graph", () => {
    const wf = buildWanVideoWorkflow({ video: DEFAULT_SETTINGS.video, prompt: "p", negativePrompt: "n", seed: 3, startImageInput: "local-imagine/s.png", filenamePrefix: "v" });
    expect(byClass(wf, "Wan22ImageToVideoLatent")[0].inputs.start_image).toBeDefined();
    expect(byClass(wf, "SaveVideo")).toHaveLength(1);
    expect(byClass(wf, "KSampler")[0].inputs.sampler_name).toBe("uni_pc");
  });
  it("builds the AnimateDiff graph with frames as batch size", () => {
    const wf = buildAnimateDiffWorkflow({ video: { ...DEFAULT_SETTINGS.video, frames: 16 }, prompt: "p", negativePrompt: "n", seed: 3, filenamePrefix: "v", checkpoint: "sd15.safetensors", sampler: "euler", scheduler: "normal" });
    expect(byClass(wf, "EmptyLatentImage")[0].inputs.batch_size).toBe(16);
    expect(byClass(wf, "VHS_VideoCombine")[0].inputs.format).toBe("video/h264-mp4");
  });
});
