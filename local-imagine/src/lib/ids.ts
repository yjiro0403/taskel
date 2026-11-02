import { randomBytes } from "crypto";

/** Short, URL-safe, time-sortable id (base36 timestamp + random). */
export function newId(prefix = ""): string {
  const t = Date.now().toString(36);
  const r = randomBytes(5).toString("hex");
  return `${prefix}${t}${r}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Random 32-bit-ish seed within ComfyUI's accepted range */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}
