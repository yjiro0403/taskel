import {
  AspectRatio,
  Chat,
  ChatSummary,
  GenParams,
  HealthStatus,
  ImageModelCatalog,
  LlmModelInfo,
  Persona,
  Settings,
  StreamEvent,
} from "@/lib/types";

/** Thin fetch wrappers for the app's own API; all client-side. */

export type PersonaPatch = Partial<Omit<Persona, "lora" | "checkpoint">> & { lora?: Persona["lora"] | null; checkpoint?: string | null };

async function j<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => j<HealthStatus>("/api/health"),
  settings: () => j<Settings>("/api/settings"),
  saveSettings: (patch: Partial<Settings>) => j<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),
  llmModels: () => j<{ models: LlmModelInfo[]; error?: string }>("/api/models/llm"),
  imageModels: (refresh = false) => j<{ catalog: ImageModelCatalog | null; error?: string }>(`/api/models/image${refresh ? "?refresh=1" : ""}`),

  personas: () => j<{ personas: Persona[] }>("/api/personas"),
  createPersona: (input: Partial<Persona>) => j<Persona>("/api/personas", { method: "POST", body: JSON.stringify(input) }),
  /** `lora: null` / `checkpoint: null` clear the field (undefined would be dropped by JSON.stringify). */
  updatePersona: (id: string, patch: PersonaPatch) => j<Persona>(`/api/personas/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deletePersona: (id: string) => j<{ ok: true }>(`/api/personas/${id}`, { method: "DELETE" }),
  uploadRefs: (id: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return j<Persona>(`/api/personas/${id}/refs`, { method: "POST", body: form });
  },
  promoteRef: (id: string, fromGenerated: string) => j<Persona>(`/api/personas/${id}/refs`, { method: "POST", body: JSON.stringify({ fromGenerated }) }),
  removeRef: (id: string, file: string) => j<Persona>(`/api/personas/${id}/refs?file=${encodeURIComponent(file)}`, { method: "DELETE" }),

  chats: (personaId: string) => j<{ chats: ChatSummary[] }>(`/api/chats?personaId=${encodeURIComponent(personaId)}`),
  chat: (id: string) => j<Chat>(`/api/chats/${id}`),
  createChat: (personaId: string, title?: string) => j<Chat>("/api/chats", { method: "POST", body: JSON.stringify({ personaId, title }) }),
  renameChat: (id: string, title: string) => j<Chat>(`/api/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteChat: (id: string) => j<{ ok: true }>(`/api/chats/${id}`, { method: "DELETE" }),
  cancelChat: (id: string) => j<{ cancelled: boolean }>(`/api/chats/${id}/cancel`, { method: "POST" }),

  uploadAttachments: (chatId: string, files: File[]) => {
    const form = new FormData();
    form.append("chatId", chatId);
    files.forEach((f) => form.append("files", f));
    return j<{ files: string[] }>("/api/uploads", { method: "POST", body: form });
  },
  interrupt: () => j<{ ok: true }>("/api/comfy/interrupt", { method: "POST" }),
};

export function fileUrl(rel: string): string {
  return `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * POST and consume a text/event-stream response, invoking onEvent for each StreamEvent.
 * Resolves when the stream ends; rejects on network errors.
 */
export async function streamPost(url: string, body: unknown, onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
        } catch {
          /* malformed frame */
        }
      }
    }
  }
}

export interface DirectGenerateBody {
  chatId: string;
  prompt: string;
  negativePrompt?: string;
  params?: Partial<GenParams> & { aspect?: AspectRatio };
  compose?: boolean;
  note?: string;
}
