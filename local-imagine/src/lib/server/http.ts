import { NextResponse } from "next/server";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(err: unknown) {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const name = (err as Error)?.name;
  // Backend errors are meant for the user; anything else is logged and replaced by a generic message.
  if (name === "ComfyError" || name === "OllamaError" || name === "ValidationError") {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  console.error("[api]", err);
  return NextResponse.json({ error: "Internal error (see server log)" }, { status: 500 });
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
};

export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file";
}
