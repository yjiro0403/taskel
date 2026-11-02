import { promises as fs } from "fs";
import path from "path";
import {
  Chat,
  ChatSummary,
  DEFAULT_SETTINGS,
  Persona,
  Settings,
} from "@/lib/types";
import { newId, nowIso } from "@/lib/ids";

/**
 * Tiny JSON-file persistence layer.
 *
 * Layout (relative to DATA_DIR, default ./data):
 *   settings.json
 *   personas/<personaId>/persona.json
 *   personas/<personaId>/refs/<file>.png      reference images
 *   chats/<chatId>.json                       chat metadata + messages
 *   images/<chatId>/<file>.png|.mp4           generated outputs
 *   uploads/<chatId>/<file>.png               images attached by the user in a chat
 *
 * A single-user local app does not need a database; plain files are easy to back up,
 * inspect and delete. Writes are atomic (tmp + rename) and serialised per path.
 */

export const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || "./data");

const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

/** Resolve a data-relative path and refuse anything that escapes DATA_DIR. */
export function resolveDataPath(rel: string): string {
  const abs = path.resolve(DATA_DIR, rel);
  if (abs !== DATA_DIR && !abs.startsWith(DATA_DIR + path.sep)) {
    throw new Error(`Path escapes data dir: ${rel}`);
  }
  return abs;
}

async function readJson<T>(rel: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(resolveDataPath(rel), "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeJson(rel: string, value: unknown): Promise<void> {
  const abs = resolveDataPath(rel);
  await withLock(abs, async () => {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tmp, abs);
  });
}

export async function saveBinary(rel: string, data: Buffer | Uint8Array): Promise<string> {
  const abs = resolveDataPath(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
  return rel;
}

export async function readBinary(rel: string): Promise<Buffer> {
  return fs.readFile(resolveDataPath(rel));
}

export async function removeFile(rel: string): Promise<void> {
  try {
    await fs.rm(resolveDataPath(rel), { force: true });
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- settings

export async function getSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>("settings.json");
  // Deep-merge so new defaults appear for users with an older settings.json
  return {
    ...DEFAULT_SETTINGS,
    ...(stored ?? {}),
    defaults: { ...DEFAULT_SETTINGS.defaults, ...(stored?.defaults ?? {}) },
    video: { ...DEFAULT_SETTINGS.video, ...(stored?.video ?? {}) },
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    ...current,
    ...patch,
    defaults: { ...current.defaults, ...(patch.defaults ?? {}) },
    video: { ...current.video, ...(patch.video ?? {}) },
  };
  await writeJson("settings.json", next);
  return next;
}

// ---------------------------------------------------------------- personas

export async function listPersonas(): Promise<Persona[]> {
  const dir = resolveDataPath("personas");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const personas = await Promise.all(entries.map((id) => readJson<Persona>(`personas/${id}/persona.json`)));
  return personas
    .filter((p): p is Persona => !!p)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getPersona(id: string): Promise<Persona | null> {
  return readJson<Persona>(`personas/${id}/persona.json`);
}

export async function createPersona(input: Partial<Persona>): Promise<Persona> {
  const now = nowIso();
  const persona: Persona = {
    id: newId("p_"),
    name: input.name?.trim() || "新しい人物",
    description: input.description ?? "",
    appearance: input.appearance ?? "",
    style: input.style ?? "",
    negativePrompt: input.negativePrompt ?? "",
    referenceImages: [],
    lora: input.lora,
    triggerWords: input.triggerWords ?? "",
    checkpoint: input.checkpoint,
    nsfw: input.nsfw ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await writeJson(`personas/${persona.id}/persona.json`, persona);
  return persona;
}

export async function updatePersona(id: string, patch: Partial<Persona>): Promise<Persona | null> {
  const current = await getPersona(id);
  if (!current) return null;
  const next: Persona = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };
  await writeJson(`personas/${id}/persona.json`, next);
  return next;
}

export async function deletePersona(id: string): Promise<void> {
  const chats = await listChats(id);
  await Promise.all(chats.map((c) => deleteChat(c.id)));
  await fs.rm(resolveDataPath(`personas/${id}`), { recursive: true, force: true });
}

// ---------------------------------------------------------------- chats

function summarise(chat: Chat): ChatSummary {
  let imageCount = 0;
  let lastImage: string | undefined;
  for (const m of chat.messages) {
    for (const g of m.generations ?? []) {
      for (const img of g.images) {
        imageCount++;
        if (img.kind === "image") lastImage = img.file;
      }
    }
  }
  return {
    id: chat.id,
    personaId: chat.personaId,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
    imageCount,
    lastImage,
  };
}

export async function listChats(personaId?: string): Promise<ChatSummary[]> {
  const dir = resolveDataPath("chats");
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const chats = await Promise.all(entries.map((f) => readJson<Chat>(`chats/${f}`)));
  return chats
    .filter((c): c is Chat => !!c && (!personaId || c.personaId === personaId))
    .map(summarise)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getChat(id: string): Promise<Chat | null> {
  return readJson<Chat>(`chats/${id}.json`);
}

export async function createChat(personaId: string, title?: string): Promise<Chat> {
  const now = nowIso();
  const chat: Chat = {
    id: newId("c_"),
    personaId,
    title: title?.trim() || "新しいチャット",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await writeJson(`chats/${chat.id}.json`, chat);
  return chat;
}

export async function saveChat(chat: Chat): Promise<Chat> {
  chat.updatedAt = nowIso();
  await writeJson(`chats/${chat.id}.json`, chat);
  return chat;
}

/** Read-modify-write a chat under a lock so concurrent generation events do not clobber each other. */
export async function mutateChat(id: string, fn: (chat: Chat) => void | Promise<void>): Promise<Chat | null> {
  return withLock(`chat:${id}`, async () => {
    const chat = await getChat(id);
    if (!chat) return null;
    await fn(chat);
    await saveChat(chat);
    return chat;
  });
}

export async function deleteChat(id: string): Promise<void> {
  await fs.rm(resolveDataPath(`chats/${id}.json`), { force: true });
  await fs.rm(resolveDataPath(`images/${id}`), { recursive: true, force: true });
  await fs.rm(resolveDataPath(`uploads/${id}`), { recursive: true, force: true });
}

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}
