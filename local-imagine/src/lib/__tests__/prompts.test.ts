import { describe, expect, it } from "vitest";
import { composeNegative, composePositive, dedupeTags, effectivePromptStyle, qualityPrefix } from "@/lib/server/prompts";
import { Persona, guessCheckpointFamily } from "@/lib/types";

const persona: Persona = {
  id: "p1",
  name: "Aoi",
  description: "",
  appearance: "1girl, long silver hair, blue eyes",
  style: "anime style",
  negativePrompt: "glasses",
  referenceImages: [],
  lora: { name: "aoi.safetensors", strength: 0.8 },
  triggerWords: "ohwx_aoi",
  nsfw: false,
  createdAt: "",
  updatedAt: "",
};

describe("checkpoint family detection", () => {
  it("recognises common families", () => {
    expect(guessCheckpointFamily("ponyDiffusionV6XL.safetensors")).toBe("pony");
    expect(guessCheckpointFamily("illustriousXL_v01.safetensors")).toBe("illustrious");
    expect(guessCheckpointFamily("juggernautXL_v9.safetensors")).toBe("sdxl");
    expect(guessCheckpointFamily("realisticVisionV60B1_v51VAE.safetensors")).toBe("sd15");
    expect(guessCheckpointFamily("flux1-schnell-fp8.safetensors")).toBe("flux");
  });
  it("maps families to prompt styles", () => {
    expect(effectivePromptStyle("auto", "pony")).toBe("tags");
    expect(effectivePromptStyle("auto", "flux")).toBe("natural");
    expect(effectivePromptStyle("tags", "flux")).toBe("tags");
  });
});

describe("prompt composition", () => {
  it("injects trigger words, quality tags, identity and style, deduplicating tags", () => {
    const p = composePositive(persona, "1girl, sitting, cafe", "pony", false);
    expect(p.startsWith("ohwx_aoi, score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up, rating_safe, 1girl, long silver hair, blue eyes")).toBe(true);
    expect(p.endsWith("sitting, cafe, anime style")).toBe(true);
    expect(p.match(/1girl/g)?.length).toBe(1);
  });
  it("uses rating_explicit for NSFW pony prompts", () => {
    expect(qualityPrefix("pony", true)).toContain("rating_explicit");
    expect(qualityPrefix("flux", true)).toBe("");
  });
  it("merges negatives without duplicates", () => {
    const n = composeNegative(persona, "text, glasses", "sdxl");
    expect(n.match(/glasses/g)?.length).toBe(1);
    expect(n.match(/\btext\b/g)?.length).toBe(1);
    expect(n).toContain("lowres");
  });
  it("dedupeTags keeps first occurrence", () => {
    expect(dedupeTags("a, b, A, c, b")).toBe("a, b, c");
  });
});
