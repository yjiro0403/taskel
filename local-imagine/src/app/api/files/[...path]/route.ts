import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { resolveDataPath } from "@/lib/server/store";
import { IMAGE_MIME, notFound } from "@/lib/server/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ path: string[] }> };

/** Serves files from DATA_DIR (generated images, reference images, uploads). */
export async function GET(req: Request, ctx: Ctx) {
  const { path: parts } = await ctx.params;
  const rel = parts.map(decodeURIComponent).join("/");
  let abs: string;
  try {
    abs = resolveDataPath(rel);
  } catch {
    return notFound();
  }
  let info;
  try {
    info = await stat(abs);
  } catch {
    return notFound();
  }
  if (!info.isFile()) return notFound();

  const ext = path.extname(abs).toLowerCase();
  const type = IMAGE_MIME[ext] ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "content-type": type,
    "cache-control": "private, max-age=31536000, immutable",
    "content-length": String(info.size),
    "accept-ranges": "bytes",
  };

  // Range support so <video> can seek
  const range = req.headers.get("range");
  if (range && type.startsWith("video/")) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), info.size - 1) : info.size - 1;
      if (start <= end) {
        headers["content-range"] = `bytes ${start}-${end}/${info.size}`;
        headers["content-length"] = String(end - start + 1);
        const stream = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream;
        return new Response(stream, { status: 206, headers });
      }
    }
  }
  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new Response(stream, { headers });
}
