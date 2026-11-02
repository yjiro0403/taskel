"use client";

import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp, Loader2, RefreshCw, Shuffle, Video } from "lucide-react";
import { GenerationBatch } from "@/lib/types";
import { fileUrl } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";

export function GenerationGrid({ messageId, batch }: { messageId: string; batch: GenerationBatch }) {
  const progress = useAppStore((s) => s.progress);
  const busy = useAppStore((s) => s.busy);
  const settings = useAppStore((s) => s.settings);
  const { setLightbox, generateDirect } = useAppStore();
  const [showPrompt, setShowPrompt] = useState(false);

  const total = batch.params.mode === "video" ? 1 : batch.params.batchCount;
  const placeholders = batch.status === "running" || batch.status === "queued" ? Math.max(0, total - batch.images.length) : 0;
  const isActive = progress?.batchId === batch.id;
  const pct = isActive && progress ? Math.round((progress.value / Math.max(1, progress.max)) * 100) : 0;
  const cols = total <= 1 ? "grid-cols-1 max-w-sm" : total === 2 ? "grid-cols-2" : total === 3 ? "grid-cols-3" : "grid-cols-2 md:grid-cols-4";

  const rerun = (seed: number, count: number, note: string) =>
    generateDirect({
      prompt: batch.prompt,
      negativePrompt: batch.negativePrompt,
      params: { ...batch.params, seed, batchCount: count, mode: "txt2img" },
      compose: false,
      note,
    });

  return (
    <div className="mt-2">
      <div className={clsx("grid gap-2", cols)}>
        {batch.images.map((img) => (
          <button
            key={img.id}
            className="group relative overflow-hidden rounded-lg border border-border bg-panel-2"
            style={{ aspectRatio: `${img.width} / ${img.height}` }}
            onClick={() => setLightbox({ messageId, batchId: batch.id, imageId: img.id })}
          >
            {img.kind === "video" ? (
              <video src={fileUrl(img.file)} className="h-full w-full object-cover" muted loop autoPlay playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(img.file)} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
            )}
            <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white opacity-0 transition group-hover:opacity-100">seed {img.seed}</span>
          </button>
        ))}
        {Array.from({ length: placeholders }).map((_, i) => {
          const idx = batch.images.length + i;
          const active = isActive && progress?.imageIndex === idx;
          return (
            <div
              key={`ph-${i}`}
              className={clsx("relative flex items-center justify-center overflow-hidden rounded-lg border border-border", active ? "bg-panel-2" : "shimmer")}
              style={{ aspectRatio: `${batch.params.mode === "video" ? settings?.video.width ?? 1 : batch.params.width} / ${batch.params.mode === "video" ? settings?.video.height ?? 1 : batch.params.height}` }}
            >
              {active ? (
                <div className="flex flex-col items-center gap-2 text-xs text-muted">
                  <Loader2 className="animate-spin" size={20} />
                  <span>{pct}%</span>
                  <div className="h-1 w-24 overflow-hidden rounded bg-border">
                    <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ) : (
                <span className="text-xs text-muted">待機中</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
        <span>
          {batch.params.mode === "video" ? <Video size={11} className="inline" /> : null} {batch.params.width}×{batch.params.height} · {batch.params.steps} steps · cfg {batch.params.cfg} ·{" "}
          {batch.params.checkpoint.replace(/\.(safetensors|ckpt)$/i, "")}
          {batch.params.referenceImages.length > 0 && ` · 参照 ${batch.params.referenceImages.length} 枚`}
          {batch.params.loras.length > 0 && ` · LoRA ${batch.params.loras.map((l) => l.name).join(", ")}`}
          {batch.durationMs ? ` · ${(batch.durationMs / 1000).toFixed(0)}s` : ""}
        </span>
        {batch.status === "error" && <span className="text-danger">エラー: {batch.error}</span>}
        {batch.status === "cancelled" && <span className="text-warn">キャンセルしました</span>}
        <span className="flex-1" />
        <button className="btn-icon" title="プロンプトを表示" onClick={() => setShowPrompt(!showPrompt)}>
          {showPrompt ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {batch.params.mode !== "video" && (
          <>
            <button className="btn-icon" title="同じプロンプトで別のシード (バリエーション)" disabled={busy} onClick={() => void rerun(-1, batch.params.batchCount, "バリエーションを生成しました。")}>
              <Shuffle size={14} />
            </button>
            {batch.status === "error" && (
              <button className="btn-icon" title="再試行" disabled={busy} onClick={() => void rerun(-1, batch.params.batchCount, "再試行しました。")}>
                <RefreshCw size={14} />
              </button>
            )}
          </>
        )}
      </div>
      {showPrompt && (
        <div className="mt-1 rounded-md border border-border bg-panel-2 p-2 text-[11px] leading-relaxed text-muted">
          <div>
            <span className="text-text">Prompt:</span> {batch.prompt}
          </div>
          {batch.negativePrompt && (
            <div className="mt-1">
              <span className="text-text">Negative:</span> {batch.negativePrompt}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
