"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ChatView } from "./ChatView";
import { ChatInput } from "./ChatInput";
import { PersonaPanel } from "./PersonaPanel";
import { SettingsModal } from "./SettingsModal";
import { Lightbox } from "./Lightbox";
import { EmptyState } from "./EmptyState";

export function Studio() {
  const init = useAppStore((s) => s.init);
  const ready = useAppStore((s) => s.ready);
  const currentPersonaId = useAppStore((s) => s.currentPersonaId);
  const personaPanelOpen = useAppStore((s) => s.personaPanelOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const lightbox = useAppStore((s) => s.lightbox);
  const toast = useAppStore((s) => s.toast);
  const refreshHealth = useAppStore((s) => s.refreshHealth);

  useEffect(() => {
    void init();
    const t = setInterval(() => void refreshHealth(), 30000);
    return () => clearInterval(t);
  }, [init, refreshHealth]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center text-muted">
        <span className="animate-pulse">Local Imagine を起動中…</span>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {currentPersonaId ? (
          <>
            <TopBar />
            <ChatView />
            <ChatInput />
          </>
        ) : (
          <EmptyState />
        )}
      </main>
      {personaPanelOpen && currentPersonaId && <PersonaPanel />}
      {settingsOpen && <SettingsModal />}
      {lightbox && <Lightbox />}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-panel px-4 py-2 text-sm shadow-xl">{toast}</div>
      )}
    </div>
  );
}
