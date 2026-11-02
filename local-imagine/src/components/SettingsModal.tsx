"use client";

import { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Settings } from "@/lib/types";
import { Field, Modal, Select, Toggle } from "./ui";

export function SettingsModal() {
  const settings = useAppStore((s) => s.settings);
  const catalog = useAppStore((s) => s.catalog);
  const llmModels = useAppStore((s) => s.llmModels);
  const health = useAppStore((s) => s.health);
  const { saveSettings, setSettingsOpen, refreshHealth, refreshModels, showToast } = useAppStore();
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [saving, setSaving] = useState(false);
  if (!draft) return null;

  const d = draft.defaults;
  const v = draft.video;
  const set = (p: Partial<Settings>) => setDraft({ ...draft, ...p });
  const setD = (p: Partial<Settings["defaults"]>) => setDraft({ ...draft, defaults: { ...d, ...p } });
  const setV = (p: Partial<Settings["video"]>) => setDraft({ ...draft, video: { ...v, ...p } });

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings(draft);
      await Promise.all([refreshHealth(), refreshModels(true)]);
      showToast("設定を保存しました");
      setSettingsOpen(false);
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const num = (val: string, fallback: number) => (val === "" || Number.isNaN(Number(val)) ? fallback : Number(val));

  return (
    <Modal title="設定" onClose={() => setSettingsOpen(false)} width="max-w-3xl">
      <div className="grid gap-5 md:grid-cols-2">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">接続</h3>
          <Field label="Ollama URL" hint={health?.ollama.ok ? `接続OK (v${health.ollama.version})` : health?.ollama.error}>
            <input className="input" value={draft.ollamaUrl} onChange={(e) => set({ ollamaUrl: e.target.value })} />
          </Field>
          <Field label="ComfyUI URL" hint={health?.comfy.ok ? `接続OK · ${health.comfy.device ?? ""}` : health?.comfy.error}>
            <input className="input" value={draft.comfyUrl} onChange={(e) => set({ comfyUrl: e.target.value })} />
          </Field>
          <Field label="チャット用 LLM (Ollama)">
            <Select value={draft.llmModel} placeholder="選択" options={llmModels.map((m) => m.name)} onChange={(val) => set({ llmModel: val })} />
          </Field>
          <Field label="画像認識モデル (任意)" hint="添付画像の内容を読むためのビジョンモデル (例: qwen3-vl, gemma3, llava)。無しでも IP-Adapter 参照は動きます。">
            <Select value={draft.visionModel} placeholder="使わない" options={llmModels.map((m) => m.name)} onChange={(val) => set({ visionModel: val })} />
          </Field>
          <Field label="Temperature">
            <input type="number" step={0.1} min={0} max={2} className="input" value={draft.temperature} onChange={(e) => set({ temperature: num(e.target.value, 0.8) })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="LLM の keep_alive" hint='"0" = 返答後すぐ LLM を解放 (8GB Mac 推奨)。"5m" = 5 分保持'>
              <input className="input" value={draft.llmKeepAlive} onChange={(e) => set({ llmKeepAlive: e.target.value })} />
            </Field>
            <Field label="コンテキスト長 (num_ctx)" hint="8GB: 4096-8192 / 16GB: 8192-16384">
              <input type="number" step={1024} min={2048} className="input" value={draft.llmNumCtx} onChange={(e) => set({ llmNumCtx: num(e.target.value, 8192) })} />
            </Field>
          </div>
          <Field label="LLM に渡す履歴の数">
            <input type="number" min={2} max={100} className="input" value={draft.historyLimit} onChange={(e) => set({ historyLimit: num(e.target.value, 20) })} />
          </Field>
          <Field label="返答の言語">
            <Select value={draft.language} options={[{ value: "auto", label: "自動 (ユーザーに合わせる)" }, { value: "ja", label: "日本語" }, { value: "en", label: "English" }]} onChange={(val) => set({ language: val as Settings["language"] })} />
          </Field>
          <Toggle checked={draft.nsfwAllowed} onChange={(val) => set({ nsfwAllowed: val })} label="NSFW を許可 (全体スイッチ)" />
          <p className="text-[11px] leading-snug text-muted">人物ごとの「NSFW を許可」も必要です。未成年・実在人物の描写は常に禁止です。モデル側のフィルタはありませんので、checkpoint の選択で内容が決まります。</p>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">画像生成の既定値</h3>
          <Field label="既定の checkpoint">
            <Select value={draft.checkpoint} placeholder="選択" options={catalog?.checkpoints ?? []} onChange={(val) => set({ checkpoint: val })} />
          </Field>
          <Field label="プロンプトの書き方" hint="auto: checkpoint 名から判定 (Pony/Illustrious/SD1.5 → タグ, SDXL/Flux → 自然文)">
            <Select value={draft.promptStyle} options={[{ value: "auto", label: "自動" }, { value: "tags", label: "タグ (Danbooru 風)" }, { value: "natural", label: "自然文" }]} onChange={(val) => set({ promptStyle: val as Settings["promptStyle"] })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Steps">
              <input type="number" className="input" value={d.steps} onChange={(e) => setD({ steps: num(e.target.value, 25) })} />
            </Field>
            <Field label="CFG">
              <input type="number" step={0.5} className="input" value={d.cfg} onChange={(e) => setD({ cfg: num(e.target.value, 6) })} />
            </Field>
            <Field label="Sampler">
              <Select value={d.sampler} options={catalog?.samplers ?? [d.sampler]} onChange={(val) => setD({ sampler: val })} />
            </Field>
            <Field label="Scheduler">
              <Select value={d.scheduler} options={catalog?.schedulers ?? [d.scheduler]} onChange={(val) => setD({ scheduler: val })} />
            </Field>
            <Field label="幅 (アスペクト未指定時)">
              <input type="number" step={64} className="input" value={d.width} onChange={(e) => setD({ width: num(e.target.value, 832) })} />
            </Field>
            <Field label="高さ">
              <input type="number" step={64} className="input" value={d.height} onChange={(e) => setD({ height: num(e.target.value, 1216) })} />
            </Field>
            <Field label="1回の枚数">
              <input type="number" min={1} max={8} className="input" value={d.batchCount} onChange={(e) => setD({ batchCount: num(e.target.value, 2) })} />
            </Field>
            <Field label="IP-Adapter 強度">
              <input type="number" step={0.05} min={0} max={1.5} className="input" value={d.ipAdapterWeight} onChange={(e) => setD({ ipAdapterWeight: num(e.target.value, 0.7) })} />
            </Field>
            <Field label="CLIP skip" hint="0 = 自動 (Pony / SD1.5 は 2)">
              <input type="number" min={0} max={4} className="input" value={d.clipSkip} onChange={(e) => setD({ clipSkip: num(e.target.value, 0) })} />
            </Field>
          </div>

          <Toggle checked={draft.fastMode} onChange={(val) => set({ fastMode: val })} label="高速モード (Lightning / Hyper-SD LoRA)" />
          {draft.fastMode && (
            <div className="grid grid-cols-3 gap-2">
              <Field label="高速化 LoRA" className="col-span-2" hint="models/loras に置いた SDXL-Lightning / Hyper-SD の LoRA。euler + sgm_uniform, CFG 1.5 で数ステップ生成します。">
                <Select value={draft.fastLora} placeholder="選択" options={catalog?.loras ?? []} onChange={(val) => set({ fastLora: val })} />
              </Field>
              <Field label="Steps">
                <input type="number" min={2} max={12} className="input" value={draft.fastSteps} onChange={(e) => set({ fastSteps: num(e.target.value, 8) })} />
              </Field>
            </div>
          )}

          <h3 className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted">動画 (実験的)</h3>
          <Toggle checked={v.enabled} onChange={(val) => setV({ enabled: val })} label="動画生成を有効にする" />
          {v.enabled && (
            <>
              <Field label="方式" hint={v.preset === "wan22-ti2v-5b" ? `Wan 2.2 TI2V 5B (ComfyUI コアノード)。ノード検出: ${catalog?.hasWanVideo ? "OK" : "未検出 — ComfyUI を更新"}` : `AnimateDiff (SD1.5)。ノード検出: ${catalog?.hasAnimateDiff ? "OK" : "未検出 — AnimateDiff-Evolved と VideoHelperSuite を導入"}`}>
                <Select value={v.preset} options={[{ value: "wan22-ti2v-5b", label: "Wan 2.2 TI2V 5B (高品質・重い)" }, { value: "animatediff-sd15", label: "AnimateDiff SD1.5 (軽量)" }]} onChange={(val) => setV({ preset: val as Settings["video"]["preset"] })} />
              </Field>
              {v.preset === "wan22-ti2v-5b" ? (
                <>
                  <Field label="Diffusion model (models/diffusion_models)">
                    <Select value={v.unetName} options={catalog?.unets.length ? catalog.unets : [v.unetName]} onChange={(val) => setV({ unetName: val })} />
                  </Field>
                  <Field label="Text encoder (models/text_encoders)">
                    <Select value={v.clipName} options={catalog?.clips.length ? catalog.clips : [v.clipName]} onChange={(val) => setV({ clipName: val })} />
                  </Field>
                  <Field label="VAE (models/vae)">
                    <Select value={v.vaeName} options={catalog?.vaes.length ? catalog.vaes : [v.vaeName]} onChange={(val) => setV({ vaeName: val })} />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="SD1.5 checkpoint">
                    <Select value={v.sd15Checkpoint} placeholder="既定の checkpoint を使う" options={catalog?.checkpoints ?? []} onChange={(val) => setV({ sd15Checkpoint: val })} />
                  </Field>
                  <Field label="Motion module (models/animatediff_models)">
                    <input className="input" value={v.motionModule} onChange={(e) => setV({ motionModule: e.target.value })} />
                  </Field>
                </>
              )}
              <div className="grid grid-cols-3 gap-2">
                <Field label="フレーム数">
                  <input type="number" className="input" value={v.frames} onChange={(e) => setV({ frames: num(e.target.value, 33) })} />
                </Field>
                <Field label="FPS">
                  <input type="number" className="input" value={v.fps} onChange={(e) => setV({ fps: num(e.target.value, 16) })} />
                </Field>
                <Field label="Steps">
                  <input type="number" className="input" value={v.steps} onChange={(e) => setV({ steps: num(e.target.value, 20) })} />
                </Field>
                <Field label="幅">
                  <input type="number" step={16} className="input" value={v.width} onChange={(e) => setV({ width: num(e.target.value, 640) })} />
                </Field>
                <Field label="高さ">
                  <input type="number" step={16} className="input" value={v.height} onChange={(e) => setV({ height: num(e.target.value, 640) })} />
                </Field>
                <Field label="CFG">
                  <input type="number" step={0.5} className="input" value={v.cfg} onChange={(e) => setV({ cfg: num(e.target.value, 5) })} />
                </Field>
              </div>
            </>
          )}
        </section>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn" onClick={() => setSettingsOpen(false)}>
          キャンセル
        </button>
        <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </Modal>
  );
}
