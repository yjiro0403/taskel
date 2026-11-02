import { describe, expect, it } from "vitest";
import { directGenerateSchema, isAppImagePath, parseSettingsPatch, sniffImageExt } from "@/lib/server/validation";
import { isValidId } from "@/lib/types";
import { buildWanVideoWorkflow } from "@/lib/server/workflows";
import { DEFAULT_SETTINGS } from "@/lib/types";

describe("ids and paths", () => {
  it("accepts generated ids and rejects traversal", () => {
    expect(isValidId("c_mvyru88g4f405f2a9f")).toBe(true);
    expect(isValidId("../chats")).toBe(false);
    expect(isValidId("c_x/..")).toBe(false);
    expect(isValidId(42)).toBe(false);
  });
  it("only accepts image paths this app produced", () => {
    expect(isAppImagePath("uploads/c_mvyru88g4f405f2a9f/u_abc12345.png")).toBe(true);
    expect(isAppImagePath("images/c_mvyru88g4f405f2a9f/g_x1234567_0_12.png")).toBe(true);
    expect(isAppImagePath("personas/p_mvyru86cfee3431d4c/refs/ref_abc12345.jpg")).toBe(true);
    expect(isAppImagePath("uploads/c_mvyru88g4f405f2a9f/../../settings.json")).toBe(false);
    expect(isAppImagePath("settings.json")).toBe(false);
    expect(isAppImagePath("chats/c_mvyru88g4f405f2a9f.json")).toBe(false);
  });
  it("sniffs image magic bytes", () => {
    expect(sniffImageExt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]))).toBe(".png");
    expect(sniffImageExt(Buffer.from("not an image at all"))).toBe(null);
  });
});

describe("settings validation", () => {
  it("coerces numbers and rejects bad urls / empty keep_alive", () => {
    const ok = parseSettingsPatch({ historyLimit: "12", defaults: { steps: "30" }, llmKeepAlive: "0" });
    expect(ok.ok && ok.data.historyLimit).toBe(12);
    expect(ok.ok && ok.data.defaults?.steps).toBe(30);
    expect(parseSettingsPatch({ ollamaUrl: "ftp://x" }).ok).toBe(false);
    expect(parseSettingsPatch({ llmKeepAlive: "" }).ok).toBe(false);
    expect(parseSettingsPatch({ historyLimit: 0 }).ok).toBe(false);
    expect(parseSettingsPatch({ unknownKey: 1 }).ok).toBe(false);
  });
  it("rejects garbage generate params", () => {
    expect(directGenerateSchema.safeParse({ chatId: "c_x", prompt: "p", params: { batchCount: "zzz" } }).success).toBe(false);
    expect(directGenerateSchema.safeParse({ chatId: "c_x", prompt: "p", params: { batchCount: 4, seed: -1, aspect: "2:3" } }).success).toBe(true);
  });
});

describe("wan parameter snapping", () => {
  it("snaps frames to 4n+1 and dimensions to multiples of 32", () => {
    const wf = buildWanVideoWorkflow({ video: { ...DEFAULT_SETTINGS.video, frames: 16, width: 500, height: 650 }, prompt: "p", negativePrompt: "n", seed: 1, filenamePrefix: "v" });
    const latent = Object.values(wf).find((n) => n.class_type === "Wan22ImageToVideoLatent")!;
    expect(latent.inputs.length).toBe(13);
    expect(latent.inputs.width).toBe(512);
    expect(latent.inputs.height).toBe(640);
  });
});
