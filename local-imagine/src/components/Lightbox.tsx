"use client";

import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Download, Shuffle, UserPlus, Video, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { fileUrl } from "@/lib/api";

export function Lightbox() {
  const lightbox = useAppStore((s) => s.lightbox);
  const chat = useAppStore((s) => s.chat);
  const busy = useAppStore((s) => s.busy);
  const settings = useAppStore((s) => s.settings);
  const catalog = useAppStore((s) => s.catalog);
  const { setLightbox, promoteRef, generateDirect } = useAppStore();

  const message = chat?.messages.find((m) => m.id === lightbox?.messageId);
  const batch = message?.generations?.find((g) => g.id === lightbox?.batchId);
  const index = batch?.images.findIndex((i) => i.id === lightbox?.imageId) ?? -1;
  const image = index >= 0 ? batch?.images[index] : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (!batch || !lightbox) return;
      if (e.key === "ArrowRight" && index < batch.images.length - 1) setLightbox({ ...lightbox, imageId: batch.images[index + 1].id });
      if (e.key === "ArrowLeft" && index > 0) setLightbox({ ...lightbox, imageId: batch.images[index - 1].id });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [batch, index, lightbox, setLightbox]);

  if (!lightbox || !batch || !image) return null;

  const videoAvailable = settings?.video.enabled && (settings.video.preset === "animatediff-sd15" ? catalog?.hasAnimateDiff : catalog?.hasWanVideo);

  const variations = () => {
    setLightbox(null);
    void generateDirect({
      prompt: batch.prompt,
      negativePrompt: batch.negativePrompt,
      params: { ...batch.params, seed: -1, batchCount: 4, mode: "txt2img" },
      compose: false,
      note: `seed ${image.seed} のバリエーションを生成しました。`,
    });
  };

  const animate = () => {
    setLightbox(null);
    void generateDirect({
      prompt: batch.prompt,
      negativePrompt: batch.negativePrompt,
      params: { ...batch.params, mode: "video", initImage: image.file, batchCount: 1 },
      compose: false,
      note: "この画像を起点に動画を生成しました (実験的機能)。",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-black/90" onClick={() => setLightbox(null)}>
      <div className="relative flex flex-1 items-center justify-center p-6" onClick={(e) => e.stopPropagation()}>
        {image.kind === "video" ? (
          <video src={fileUrl(image.file)} controls autoPlay loop className="max-h-full max-w-full rounded-lg" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileUrl(image.file)} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        )}
        {index > 0 && (
          <button className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white" onClick={() => setLightbox({ ...lightbox, imageId: batch.images[index - 1].id })}>
            <ChevronLeft />
          </button>
        )}
        {index < batch.images.length - 1 && (
          <button className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white" onClick={() => setLightbox({ ...lightbox, imageId: batch.images[index + 1].id })}>
            <ChevronRight />
          </button>
        )}
      </div>
      <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-panel p-4 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="font-semibold">
            {index + 1} / {batch.images.length}
          </span>
          <button className="btn-icon" onClick={() => setLightbox(null)}>
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a className="btn justify-center" href={fileUrl(image.file)} download>
            <Download size={14} /> 保存
          </a>
          <button className="btn justify-center" disabled={busy || image.kind === "video"} onClick={() => void promoteRef(image.file)} title="この人物の参照画像 (IP-Adapter) に追加">
            <UserPlus size={14} /> 参照に追加
          </button>
          <button className="btn justify-center" disabled={busy || image.kind === "video"} onClick={variations}>
            <Shuffle size={14} /> バリエーション ×4
          </button>
          <button className="btn justify-center" disabled={busy || !videoAvailable || image.kind === "video"} onClick={animate} title={videoAvailable ? "この画像を最初のフレームにして動画化" : "設定で動画生成を有効にし、ComfyUI に Wan 2.2 を導入してください"}>
            <Video size={14} /> 動画化
          </button>
        </div>
        <dl className="space-y-1 text-xs text-muted">
          <div className="flex justify-between"><dt>サイズ</dt><dd className="text-text">{image.width}×{image.height}</dd></div>
          <div className="flex justify-between"><dt>Seed</dt><dd className="text-text select-all">{image.seed}</dd></div>
          <div className="flex justify-between"><dt>Steps / CFG</dt><dd className="text-text">{batch.params.steps} / {batch.params.cfg}</dd></div>
          <div className="flex justify-between"><dt>Sampler</dt><dd className="text-text">{batch.params.sampler} · {batch.params.scheduler}</dd></div>
          <div className="flex justify-between gap-2"><dt>Model</dt><dd className="truncate text-text" title={batch.params.checkpoint}>{batch.params.checkpoint}</dd></div>
        </dl>
        <div>
          <div className="label">Prompt</div>
          <p className="select-all rounded-md border border-border bg-panel-2 p-2 text-xs leading-relaxed">{batch.prompt}</p>
        </div>
        {batch.negativePrompt && (
          <div>
            <div className="label">Negative</div>
            <p className="select-all rounded-md border border-border bg-panel-2 p-2 text-xs leading-relaxed text-muted">{batch.negativePrompt}</p>
          </div>
        )}
      </aside>
    </div>
  );
}
