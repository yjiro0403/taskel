"use client";

import { RefreshCw, UserRoundCog } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Select } from "./ui";

export function TopBar() {
  const settings = useAppStore((s) => s.settings);
  const llmModels = useAppStore((s) => s.llmModels);
  const catalog = useAppStore((s) => s.catalog);
  const personas = useAppStore((s) => s.personas);
  const currentPersonaId = useAppStore((s) => s.currentPersonaId);
  const chat = useAppStore((s) => s.chat);
  const personaPanelOpen = useAppStore((s) => s.personaPanelOpen);
  const { saveSettings, refreshModels, setPersonaPanelOpen, renameChat } = useAppStore();
  const persona = personas.find((p) => p.id === currentPersonaId);
  if (!settings) return null;

  const checkpoint = persona?.checkpoint || settings.checkpoint;

  return (
    <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{persona?.name}</div>
        {chat ? (
          <input
            className="w-full bg-transparent text-xs text-muted outline-none"
            defaultValue={chat.title}
            key={chat.id}
            onBlur={(e) => e.target.value.trim() && e.target.value !== chat.title && void renameChat(chat.id, e.target.value)}
          />
        ) : (
          <div className="text-xs text-muted">新しいチャット</div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="w-52">
          <Select
            value={settings.llmModel}
            placeholder={llmModels.length ? "LLM モデル" : "Ollama にモデルがありません"}
            options={llmModels.map((m) => ({ value: m.name, label: `${m.name}${m.parameterSize ? ` · ${m.parameterSize}` : ""}` }))}
            onChange={(v) => void saveSettings({ llmModel: v })}
          />
        </div>
        <div className="w-60">
          <Select
            value={checkpoint}
            placeholder={catalog?.checkpoints.length ? "画像モデル (checkpoint)" : "ComfyUI に checkpoint がありません"}
            options={catalog?.checkpoints ?? []}
            onChange={(v) => (persona?.checkpoint ? void useAppStore.getState().updatePersona(persona.id, { checkpoint: v }) : void saveSettings({ checkpoint: v }))}
          />
        </div>
        <div className="w-20">
          <Select
            value={String(settings.defaults.batchCount)}
            options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: `${n} 枚` }))}
            onChange={(v) => void saveSettings({ defaults: { ...settings.defaults, batchCount: Number(v) } })}
          />
        </div>
        <button className="btn-icon" title="モデル一覧を再読込" onClick={() => void refreshModels(true)}>
          <RefreshCw size={16} />
        </button>
        <button className={`btn-icon ${personaPanelOpen ? "text-accent" : ""}`} title="人物を編集" onClick={() => setPersonaPanelOpen(!personaPanelOpen)}>
          <UserRoundCog size={18} />
        </button>
      </div>
    </header>
  );
}
