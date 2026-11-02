"use client";

import { useRef, useState } from "react";
import { Trash2, Upload, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { fileUrl } from "@/lib/api";
import { Persona } from "@/lib/types";
import { Field, Select, Toggle } from "./ui";

function useDebouncedSave(persona: Persona | undefined) {
  const updatePersona = useAppStore((s) => s.updatePersona);
  const timer = useRef<NodeJS.Timeout | null>(null);
  const pending = useRef<Partial<Persona>>({});
  const [draft, setDraft] = useState<Persona | undefined>(persona);
  // Reset the draft when the selected persona (or its reference images) changes, without an effect.
  const key = persona ? `${persona.id}:${persona.referenceImages.join("|")}` : "";
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setDraft(persona);
  }

  const patch = (p: Partial<Persona>) => {
    if (!draft) return;
    const next = { ...draft, ...p };
    setDraft(next);
    pending.current = { ...pending.current, ...p };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const payload = pending.current;
      pending.current = {};
      void updatePersona(next.id, payload);
    }, 500);
  };
  return { draft, patch };
}

export function PersonaPanel() {
  const personas = useAppStore((s) => s.personas);
  const currentPersonaId = useAppStore((s) => s.currentPersonaId);
  const catalog = useAppStore((s) => s.catalog);
  const settings = useAppStore((s) => s.settings);
  const { setPersonaPanelOpen, uploadRefs, removeRef, deletePersona, showToast } = useAppStore();
  const persona = personas.find((p) => p.id === currentPersonaId);
  const { draft, patch } = useDebouncedSave(persona);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (!draft) return null;

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      await uploadRefs(draft.id, Array.from(files));
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">人物を編集</h2>
        <button className="btn-icon" onClick={() => setPersonaPanelOpen(false)}>
          <X size={18} />
        </button>
      </div>
      <div className="flex flex-col gap-4 p-4 text-sm">
        <Field label="名前">
          <input className="input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field label="外見 (appearance) — 毎回プロンプトに自動挿入" hint="英語のタグ推奨。髪・目・体型・年齢感・肌など「固定したい特徴」だけ。服装はチャットで指定できるように書かないのがコツ。例: 1girl, long silver hair, blue eyes, slender, fair skin, adult woman, small mole under left eye">
          <textarea className="input min-h-20" value={draft.appearance} onChange={(e) => patch({ appearance: e.target.value })} />
        </Field>
        <Field label="画風 (style) — 自動挿入" hint="例: anime style, clean lineart, soft shading / photorealistic, 85mm lens, natural light">
          <input className="input" value={draft.style} onChange={(e) => patch({ style: e.target.value })} />
        </Field>
        <Field label="キャラクターシート (LLM に渡す説明)" hint="性格・背景・好きな服・口調など。LLM がシーンやポーズを考える材料になります (日本語可)。">
          <textarea className="input min-h-28" value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
        </Field>
        <Field label="ネガティブプロンプト (追加分)">
          <input className="input" value={draft.negativePrompt} onChange={(e) => patch({ negativePrompt: e.target.value })} />
        </Field>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">参照画像 ({draft.referenceImages.length})</label>
            <button className="btn py-1 text-xs" disabled={uploading} onClick={() => fileInput.current?.click()}>
              <Upload size={12} /> {uploading ? "アップロード中…" : "追加"}
            </button>
            <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
          </div>
          <div
            className="grid grid-cols-4 gap-1.5 rounded-md border border-dashed border-border p-1.5"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFiles(e.dataTransfer.files);
            }}
          >
            {draft.referenceImages.map((f) => (
              <div key={f} className="group relative aspect-square overflow-hidden rounded">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(f)} alt="" className="h-full w-full object-cover" />
                <button className="absolute right-0.5 top-0.5 hidden rounded bg-black/70 p-0.5 text-white group-hover:block" onClick={() => void removeRef(draft.id, f)}>
                  <X size={12} />
                </button>
              </div>
            ))}
            {draft.referenceImages.length === 0 && <p className="col-span-4 py-3 text-center text-xs text-muted">ここに画像をドロップ。IP-Adapter で顔・雰囲気を揃えます。</p>}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            {catalog?.hasIPAdapter ? "ComfyUI に IP-Adapter が入っています。生成画像のライトボックスから「参照に追加」もできます。" : "ComfyUI に ComfyUI_IPAdapter_plus が未導入のため、参照画像はまだ使われません (docs/PERSONA_AND_LORA.md)。"}
          </p>
        </div>

        <Field label="LoRA (任意)" hint="models/loras に入れた LoRA。学習手順は docs/PERSONA_AND_LORA.md">
          <div className="flex gap-2">
            <Select
              className="flex-1"
              value={draft.lora?.name ?? ""}
              placeholder="なし"
              options={catalog?.loras ?? []}
              onChange={(v) => patch({ lora: v ? { name: v, strength: draft.lora?.strength ?? 0.8 } : undefined })}
            />
            <input
              type="number"
              step={0.05}
              min={0}
              max={2}
              className="input w-20"
              value={draft.lora?.strength ?? 0.8}
              disabled={!draft.lora}
              onChange={(e) => draft.lora && patch({ lora: { ...draft.lora, strength: Number(e.target.value) } })}
            />
          </div>
        </Field>
        <Field label="トリガーワード" hint="LoRA を起動する語 (例: ohwx woman)。LoRA 使用時のみ先頭に挿入。">
          <input className="input" value={draft.triggerWords} onChange={(e) => patch({ triggerWords: e.target.value })} />
        </Field>
        <Field label="この人物専用の checkpoint (任意)">
          <Select value={draft.checkpoint ?? ""} placeholder={`全体設定を使う (${settings?.checkpoint || "未設定"})`} options={catalog?.checkpoints ?? []} onChange={(v) => patch({ checkpoint: v || undefined })} />
        </Field>
        <Toggle checked={draft.nsfw} onChange={(v) => patch({ nsfw: v })} label="この人物で NSFW を許可 (18+)" />
        {draft.nsfw && !settings?.nsfwAllowed && <p className="-mt-2 text-[11px] text-warn">全体設定の「NSFW を許可」もオンにする必要があります。</p>}

        <button
          className="btn btn-danger mt-4 justify-center"
          onClick={() => {
            if (confirm(`「${draft.name}」とそのチャット・画像をすべて削除しますか？`)) void deletePersona(draft.id).then(() => setPersonaPanelOpen(false));
          }}
        >
          <Trash2 size={14} /> 人物を削除
        </button>
      </div>
    </aside>
  );
}
