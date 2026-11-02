"use client";

import { useAppStore } from "@/store/useAppStore";

export function EmptyState() {
  const health = useAppStore((s) => s.health);
  const llmModels = useAppStore((s) => s.llmModels);
  const catalog = useAppStore((s) => s.catalog);
  const { createPersona, setSettingsOpen } = useAppStore();

  const steps = [
    { ok: !!health?.ollama.ok, text: "Ollama が起動している (ollama serve)", hint: health?.ollama.error },
    { ok: llmModels.length > 0, text: "Ollama にモデルがある (例: ollama pull qwen3:8b)" },
    { ok: !!health?.comfy.ok, text: "ComfyUI が起動している (python main.py --listen 127.0.0.1 --port 8188)", hint: health?.comfy.error },
    { ok: (catalog?.checkpoints.length ?? 0) > 0, text: "ComfyUI の models/checkpoints に checkpoint がある" },
  ];

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-lg rounded-xl border border-border bg-panel p-6">
        <h2 className="text-lg font-semibold">Local Imagine へようこそ</h2>
        <p className="mt-1 text-sm text-muted">ローカル LLM と会話しながら、ローカルの ComfyUI で画像を生成するスタジオです。まずは接続状況を確認してください。</p>
        <ul className="mt-4 space-y-2">
          {steps.map((s) => (
            <li key={s.text} className="flex items-start gap-2 text-sm">
              <span className={s.ok ? "text-ok" : "text-danger"}>{s.ok ? "✔" : "✖"}</span>
              <div>
                <div>{s.text}</div>
                {!s.ok && s.hint && <div className="text-xs text-muted">{s.hint}</div>}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex gap-2">
          <button className="btn btn-primary" onClick={() => void createPersona({ name: "新しい人物" })}>
            人物を作成して始める
          </button>
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            接続設定
          </button>
        </div>
        <p className="mt-4 text-xs text-muted">セットアップ手順は docs/SETUP.md を参照してください。</p>
      </div>
    </div>
  );
}
