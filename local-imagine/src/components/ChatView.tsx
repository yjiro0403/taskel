"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { MessageItem } from "./MessageItem";

export function ChatView() {
  const chat = useAppStore((s) => s.chat);
  const status = useAppStore((s) => s.status);
  const busy = useAppStore((s) => s.busy);
  const personas = useAppStore((s) => s.personas);
  const currentPersonaId = useAppStore((s) => s.currentPersonaId);
  const persona = personas.find((p) => p.id === currentPersonaId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const messageCount = chat?.messages.length ?? 0;
  const imageCount = chat?.messages.reduce((n, m) => n + (m.generations?.reduce((k, g) => k + g.images.length, 0) ?? 0), 0) ?? 0;
  useEffect(() => {
    const total = messageCount + imageCount;
    if (total !== lastCount.current) {
      lastCount.current = total;
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messageCount, imageCount]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        {(!chat || chat.messages.length === 0) && (
          <div className="mt-10 text-center text-sm text-muted">
            <p className="text-base text-text">{persona?.name ?? "人物"} と話しながら画像を作りましょう。</p>
            <p className="mt-2">例:「カフェでコーヒーを飲んでいるところを 4 枚」「同じポーズで服を赤いドレスに」「横からのアングルで」</p>
            {persona && !persona.appearance && <p className="mt-2 text-warn">ヒント: 右上の「人物を編集」で外見 (appearance) を設定すると、毎回同じキャラクターになります。</p>}
          </div>
        )}
        {chat?.messages.map((m) => <MessageItem key={m.id} message={m} />)}
        {busy && status && <div className="text-xs text-muted animate-pulse">{status}</div>}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
