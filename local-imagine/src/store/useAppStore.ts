"use client";

import { create } from "zustand";
import {
  Chat,
  ChatSummary,
  GenerationBatch,
  HealthStatus,
  ImageModelCatalog,
  LlmModelInfo,
  Persona,
  Settings,
  StreamEvent,
} from "@/lib/types";
import { DirectGenerateBody, PersonaPatch, api, streamPost } from "@/lib/api";

export interface ProgressState {
  messageId: string;
  batchId: string;
  value: number;
  max: number;
  imageIndex: number;
}

export interface LightboxState {
  messageId: string;
  batchId: string;
  imageId: string;
}

interface AppState {
  ready: boolean;
  settings: Settings | null;
  health: HealthStatus | null;
  llmModels: LlmModelInfo[];
  llmError?: string;
  catalog: ImageModelCatalog | null;
  catalogError?: string;

  personas: Persona[];
  currentPersonaId: string | null;
  chats: ChatSummary[];
  currentChatId: string | null;
  chat: Chat | null;

  busy: boolean;
  status: string;
  progress: ProgressState | null;
  abort: AbortController | null;
  lightbox: LightboxState | null;
  personaPanelOpen: boolean;
  settingsOpen: boolean;
  toast: string | null;

  init: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  refreshModels: (force?: boolean) => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;

  loadPersonas: () => Promise<void>;
  selectPersona: (id: string | null) => Promise<void>;
  createPersona: (input?: Partial<Persona>) => Promise<Persona>;
  updatePersona: (id: string, patch: PersonaPatch) => Promise<void>;
  deletePersona: (id: string) => Promise<void>;
  uploadRefs: (id: string, files: File[]) => Promise<void>;
  removeRef: (id: string, file: string) => Promise<void>;
  promoteRef: (file: string) => Promise<void>;

  loadChats: (personaId: string) => Promise<void>;
  selectChat: (id: string | null) => Promise<void>;
  createChat: () => Promise<Chat | null>;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;

  sendMessage: (content: string, files: File[]) => Promise<void>;
  generateDirect: (body: Omit<DirectGenerateBody, "chatId">) => Promise<void>;
  cancel: () => Promise<void>;

  setLightbox: (l: LightboxState | null) => void;
  setPersonaPanelOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  showToast: (text: string) => void;
}

const LS_KEY = "local-imagine:selection";

function remember(personaId: string | null, chatId: string | null) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ personaId, chatId }));
  } catch {
    /* ignore */
  }
}

function recall(): { personaId: string | null; chatId: string | null } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { personaId: null, chatId: null };
}

function applyEvent(chat: Chat, e: StreamEvent): Chat {
  const messages = chat.messages.slice();
  const findBatch = (messageId: string, batchId: string): GenerationBatch | undefined => {
    const m = messages.find((x) => x.id === messageId);
    return m?.generations?.find((g) => g.id === batchId);
  };
  switch (e.type) {
    case "user_message":
    case "assistant_message":
      if (!messages.some((m) => m.id === e.message.id)) messages.push(e.message);
      break;
    case "batch_start":
    case "batch_end": {
      const m = messages.find((x) => x.id === e.messageId);
      if (m?.generations) {
        const idx = m.generations.findIndex((g) => g.id === e.batch.id);
        if (idx >= 0) m.generations[idx] = { ...e.batch };
      }
      break;
    }
    case "image": {
      const b = findBatch(e.messageId, e.batchId);
      if (b && !b.images.some((i) => i.id === e.image.id)) b.images = [...b.images, e.image];
      break;
    }
    default:
      break;
  }
  return { ...chat, messages };
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  settings: null,
  health: null,
  llmModels: [],
  catalog: null,
  personas: [],
  currentPersonaId: null,
  chats: [],
  currentChatId: null,
  chat: null,
  busy: false,
  status: "",
  progress: null,
  abort: null,
  lightbox: null,
  personaPanelOpen: false,
  settingsOpen: false,
  toast: null,

  init: async () => {
    try {
      const settings = await api.settings();
      set({ settings });
      await Promise.all([get().loadPersonas(), get().refreshHealth(), get().refreshModels()]);
      const { personaId, chatId } = recall();
      const personas = get().personas;
      const pid = personaId && personas.some((p) => p.id === personaId) ? personaId : personas[0]?.id ?? null;
      if (pid) {
        await get().selectPersona(pid);
        if (chatId && get().chats.some((c) => c.id === chatId)) await get().selectChat(chatId);
      }
    } catch (err) {
      get().showToast(`起動時にエラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      set({ ready: true });
    }
  },

  refreshHealth: async () => {
    try {
      set({ health: await api.health() });
    } catch {
      /* server down */
    }
  },

  refreshModels: async (force = false) => {
    const [llm, img] = await Promise.all([api.llmModels().catch((e) => ({ models: [], error: String(e) })), api.imageModels(force).catch((e) => ({ catalog: null, error: String(e) }))]);
    set({ llmModels: llm.models, llmError: llm.error, catalog: img.catalog, catalogError: img.error });
    // Auto-pick sensible defaults the first time
    const s = get().settings;
    if (s) {
      const patch: Partial<Settings> = {};
      if (!s.llmModel && llm.models.length) patch.llmModel = llm.models[0].name;
      if (!s.checkpoint && img.catalog?.checkpoints.length) patch.checkpoint = img.catalog.checkpoints[0];
      if (!s.defaults.sampler && img.catalog?.samplers.length) patch.defaults = { ...s.defaults, sampler: img.catalog.samplers[0] };
      if (Object.keys(patch).length) await get().saveSettings(patch);
    }
  },

  saveSettings: async (patch) => {
    const settings = await api.saveSettings(patch);
    set({ settings });
  },

  loadPersonas: async () => {
    const { personas } = await api.personas();
    set({ personas });
  },

  selectPersona: async (id) => {
    set({ currentPersonaId: id, currentChatId: null, chat: null, chats: [] });
    remember(id, null);
    if (id) await get().loadChats(id);
  },

  createPersona: async (input = {}) => {
    const persona = await api.createPersona(input);
    await get().loadPersonas();
    await get().selectPersona(persona.id);
    set({ personaPanelOpen: true });
    return persona;
  },

  updatePersona: async (id, patch) => {
    const persona = await api.updatePersona(id, patch);
    set({ personas: get().personas.map((p) => (p.id === id ? persona : p)) });
  },

  deletePersona: async (id) => {
    await api.deletePersona(id);
    await get().loadPersonas();
    const next = get().personas[0]?.id ?? null;
    await get().selectPersona(next);
  },

  uploadRefs: async (id, files) => {
    const persona = await api.uploadRefs(id, files);
    set({ personas: get().personas.map((p) => (p.id === id ? persona : p)) });
  },

  removeRef: async (id, file) => {
    const persona = await api.removeRef(id, file);
    set({ personas: get().personas.map((p) => (p.id === id ? persona : p)) });
  },

  promoteRef: async (file) => {
    const id = get().currentPersonaId;
    if (!id) return;
    const persona = await api.promoteRef(id, file);
    set({ personas: get().personas.map((p) => (p.id === id ? persona : p)) });
    get().showToast("参照画像に追加しました");
  },

  loadChats: async (personaId) => {
    const { chats } = await api.chats(personaId);
    set({ chats });
  },

  selectChat: async (id) => {
    set({ currentChatId: id, chat: null, lightbox: null });
    remember(get().currentPersonaId, id);
    if (id) {
      const chat = await api.chat(id);
      // The user may have switched again while this request was in flight.
      if (get().currentChatId === id) set({ chat });
    }
  },

  createChat: async () => {
    const pid = get().currentPersonaId;
    if (!pid) return null;
    const chat = await api.createChat(pid);
    await get().loadChats(pid);
    await get().selectChat(chat.id);
    return chat;
  },

  deleteChat: async (id) => {
    await api.deleteChat(id);
    const pid = get().currentPersonaId;
    if (pid) await get().loadChats(pid);
    if (get().currentChatId === id) await get().selectChat(null);
  },

  renameChat: async (id, title) => {
    await api.renameChat(id, title);
    const pid = get().currentPersonaId;
    if (pid) await get().loadChats(pid);
    const chat = get().chat;
    if (chat?.id === id) set({ chat: { ...chat, title } });
  },

  sendMessage: async (content, files) => {
    if (get().busy) return;
    let chat = get().chat;
    if (!chat) {
      chat = await get().createChat();
      if (!chat) return;
    }
    const chatId = chat.id;
    const abort = new AbortController();
    set({ busy: true, status: "", progress: null, abort });
    try {
      let attachments: string[] = [];
      if (files.length) {
        set({ status: "画像をアップロード中…" });
        attachments = (await api.uploadAttachments(chatId, files)).files;
      }
      await streamPost(
        `/api/chats/${chatId}/messages`,
        { content, attachments },
        (e) => handleEvent(e, chatId),
        abort.signal,
      );
    } catch (err) {
      if (!abort.signal.aborted) get().showToast(err instanceof Error ? err.message : String(err));
    } finally {
      await finishTurn(chatId);
    }
  },

  generateDirect: async (body) => {
    const chat = get().chat;
    if (!chat || get().busy) return;
    const chatId = chat.id;
    const abort = new AbortController();
    set({ busy: true, status: "", progress: null, abort });
    try {
      await streamPost("/api/generate", { chatId, ...body }, (e) => handleEvent(e, chatId), abort.signal);
    } catch (err) {
      if (!abort.signal.aborted) get().showToast(err instanceof Error ? err.message : String(err));
    } finally {
      await finishTurn(chatId);
    }
  },

  cancel: async () => {
    const chatId = get().currentChatId;
    const abort = get().abort;
    set({ status: "中止しています…" });
    // Ask the server to cancel: it marks the remaining batches as cancelled and ends the stream
    // normally, so the client state stays consistent. Fall back to dropping the connection.
    let serverCancelled = false;
    if (chatId) {
      try {
        serverCancelled = (await api.cancelChat(chatId)).cancelled;
      } catch {
        /* server unreachable */
      }
    }
    if (!serverCancelled) abort?.abort();
    else setTimeout(() => abort?.abort(), 15000);
  },

  setLightbox: (lightbox) => set({ lightbox }),
  setPersonaPanelOpen: (personaPanelOpen) => set({ personaPanelOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  showToast: (toast) => {
    set({ toast });
    setTimeout(() => {
      if (get().toast === toast) set({ toast: null });
    }, 4000);
  },
}));

async function finishTurn(chatId: string) {
  const { getState, setState: set } = useAppStore;
  set({ busy: false, progress: null, abort: null, status: "" });
  const pid = getState().currentPersonaId;
  if (pid) void getState().loadChats(pid);
  // Re-sync with the server copy; after a dropped connection the server may still be writing, so retry briefly.
  if (getState().currentChatId !== chatId) return;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const chat = (await api.chat(chatId)) as Chat & { generating?: boolean };
      if (getState().currentChatId !== chatId) return;
      set({ chat });
      if (!chat.generating) return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
}

function handleEvent(e: StreamEvent, chatId: string) {
  const { chat } = useAppStore.getState();
  const set = useAppStore.setState;
  if (e.type === "status") {
    set({ status: e.text });
    return;
  }
  if (e.type === "progress") {
    set({ progress: { messageId: e.messageId, batchId: e.batchId, value: e.value, max: e.max, imageIndex: e.imageIndex }, status: "" });
    return;
  }
  if (e.type === "error") {
    set({ status: e.error });
    // Errors tied to a message are rendered inside it; anything else would vanish with the stream.
    if (!e.messageId) useAppStore.getState().showToast(e.error);
    return;
  }
  if (e.type === "done") return;
  if (e.type === "batch_start") set({ status: "" });
  if (e.type === "batch_end") set({ progress: null });
  if (chat && chat.id === chatId) set({ chat: applyEvent(chat, e) });
}
