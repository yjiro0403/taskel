"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Send, Square, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

const QUICK_CHIPS = [
  { label: "別のポーズ", text: "同じ服装・場所で、別のポーズを 4 枚ください" },
  { label: "別のアングル", text: "同じシーンで、カメラアングルを変えて (横から・下から・俯瞰) 3 枚" },
  { label: "着せ替え", text: "服装を変えてください。カジュアル、フォーマル、スポーティの 3 パターン" },
  { label: "表情いろいろ", text: "同じ構図で表情だけ変えて 4 枚 (笑顔・驚き・照れ・真顔)" },
  { label: "全身", text: "全身が入る構図で、立ちポーズを 2 枚" },
  { label: "クローズアップ", text: "顔のクローズアップを 2 枚、ライティングを変えて" },
];

export function ChatInput() {
  const busy = useAppStore((s) => s.busy);
  const status = useAppStore((s) => s.status);
  const progress = useAppStore((s) => s.progress);
  const { sendMessage, cancel } = useAppStore();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // One object URL per attached file, revoked when the file list changes.
  const previews = useMemo(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  // Keep the textarea height in sync when text changes programmatically (submit, quick chips).
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [text]);

  const submit = async () => {
    const content = text.trim();
    if ((!content && files.length === 0) || busy) return;
    setText("");
    const f = files;
    setFiles([]);
    await sendMessage(content || "この画像を参考にしてください。", f);
    textarea.current?.focus();
  };

  const pct = progress ? Math.round((progress.value / Math.max(1, progress.max)) * 100) : null;

  return (
    <div className="border-t border-border bg-panel px-4 pb-4 pt-2">
      <div className="mx-auto max-w-4xl">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_CHIPS.map((c) => (
            <button key={c.label} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted hover:border-accent hover:text-text" disabled={busy} onClick={() => setText(c.text)}>
              {c.label}
            </button>
          ))}
        </div>
        {files.length > 0 && (
          <div className="mb-2 flex gap-2">
            {previews.map((p, i) => (
              <div key={p.url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="h-16 w-16 rounded-md object-cover" />
                <button className="absolute -right-1.5 -top-1.5 rounded-full bg-panel-2 p-0.5 text-muted hover:text-text" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-border bg-panel-2 p-2 focus-within:border-accent">
          <button className="btn-icon" title="画像を添付 (参照・img2img)" onClick={() => fileInput.current?.click()} disabled={busy}>
            <ImagePlus size={18} />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 6));
              e.target.value = "";
            }}
          />
          <textarea
            ref={textarea}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted"
            placeholder={busy ? "生成中…" : "どんな画像を作りますか？ (Enter で送信 / Shift+Enter で改行)"}
            value={text}
            rows={1}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // keyCode 229: Safari fires the Enter that confirms an IME composition with isComposing=false
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {busy ? (
            <button className="btn btn-danger" onClick={() => void cancel()} title="生成を中止">
              <Square size={14} /> 中止
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void submit()} disabled={!text.trim() && files.length === 0}>
              <Send size={14} /> 送信
            </button>
          )}
        </div>
        <div className="mt-1 flex h-4 items-center gap-2 text-[11px] text-muted">
          {busy && (pct !== null ? <span>生成中 {pct}%</span> : <span className="animate-pulse">{status || "処理中…"}</span>)}
        </div>
      </div>
    </div>
  );
}
