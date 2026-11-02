"use client";

import clsx from "clsx";
import { Images, MessageSquarePlus, Plus, Settings, Trash2, UserRoundPlus } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { fileUrl } from "@/lib/api";
import { StatusDot } from "./ui";
import { Persona } from "@/lib/types";

function Avatar({ persona, size = 36 }: { persona: Persona; size?: number }) {
  const ref = persona.referenceImages[0];
  return ref ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={fileUrl(ref)} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <div
      className="flex items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-sm font-semibold text-white"
      style={{ width: size, height: size }}
    >
      {persona.name.slice(0, 1)}
    </div>
  );
}

export function Sidebar() {
  const personas = useAppStore((s) => s.personas);
  const currentPersonaId = useAppStore((s) => s.currentPersonaId);
  const chats = useAppStore((s) => s.chats);
  const currentChatId = useAppStore((s) => s.currentChatId);
  const health = useAppStore((s) => s.health);
  const busy = useAppStore((s) => s.busy);
  const { selectPersona, createPersona, selectChat, createChat, deleteChat, setSettingsOpen, setPersonaPanelOpen } = useAppStore();

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold tracking-wide">Local Imagine</h1>
          <div className="mt-0.5 flex gap-3">
            <StatusDot ok={health?.ollama.ok} label="Ollama" title={health?.ollama.error ?? health?.ollama.version} />
            <StatusDot ok={health?.comfy.ok} label="ComfyUI" title={health?.comfy.error ?? health?.comfy.device} />
          </div>
        </div>
        <button className="btn-icon" onClick={() => setSettingsOpen(true)} title="設定">
          <Settings size={18} />
        </button>
      </div>

      <div className="px-3">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted">人物</span>
          <button className="btn-icon" title="人物を追加" onClick={() => void createPersona()}>
            <UserRoundPlus size={16} />
          </button>
        </div>
        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {personas.map((p) => (
            <button
              key={p.id}
              onClick={() => void selectPersona(p.id)}
              onDoubleClick={() => setPersonaPanelOpen(true)}
              className={clsx(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-panel-2",
                p.id === currentPersonaId && "bg-panel-2 ring-1 ring-accent/50",
              )}
            >
              <Avatar persona={p} size={30} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.nsfw && <span className="rounded bg-accent-2/20 px-1 text-[10px] text-accent-2">18+</span>}
            </button>
          ))}
          {personas.length === 0 && (
            <button className="btn mt-1 justify-center" onClick={() => void createPersona()}>
              <Plus size={14} /> 最初の人物を作成
            </button>
          )}
        </div>
      </div>

      {currentPersonaId && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col px-3">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted">チャット</span>
            <button className="btn-icon" title="新しいチャット" disabled={busy} onClick={() => void createChat()}>
              <MessageSquarePlus size={16} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-3">
            {chats.map((c) => (
              <div
                key={c.id}
                className={clsx(
                  "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-panel-2",
                  c.id === currentChatId && "bg-panel-2 ring-1 ring-accent/50",
                )}
                onClick={() => !busy && void selectChat(c.id)}
              >
                {c.lastImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl(c.lastImage)} alt="" className="h-8 w-8 rounded object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-panel-2 text-muted">
                    <Images size={14} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate">{c.title}</div>
                  <div className="text-[11px] text-muted">{c.imageCount} 枚 · {new Date(c.updatedAt).toLocaleDateString("ja-JP")}</div>
                </div>
                <button
                  className="btn-icon hidden group-hover:block"
                  title="チャットを削除"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("このチャットと生成画像を削除しますか？")) void deleteChat(c.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {chats.length === 0 && <p className="px-2 py-3 text-xs text-muted">まだチャットがありません。下の入力欄から話しかけると自動で作成されます。</p>}
          </div>
        </div>
      )}
    </aside>
  );
}
