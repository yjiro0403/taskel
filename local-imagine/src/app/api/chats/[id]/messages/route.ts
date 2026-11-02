import { getChat, getSettings } from "@/lib/server/store";
import { runChatTurn } from "@/lib/server/agent";
import { createSse, sseResponse } from "@/lib/server/sse";
import { badRequest, notFound } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Generation can take many minutes on an M1
export const maxDuration = 3600;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST { content: string, attachments?: string[] }  -> text/event-stream of StreamEvent
 * Attachments are data-relative paths returned by POST /api/uploads.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { content?: string; attachments?: string[] } | null;
  if (!body || typeof body.content !== "string" || (!body.content.trim() && !body.attachments?.length)) {
    return badRequest("content required");
  }
  if (!(await getChat(id))) return notFound("Chat not found");
  const settings = await getSettings();

  const { stream, send, close } = createSse();
  const attachments = (body.attachments ?? []).filter((a) => typeof a === "string" && a.startsWith(`uploads/${id}/`));

  void runChatTurn({ chatId: id, content: body.content, attachments, settings, send, signal: req.signal })
    .catch((err) => send({ type: "error", error: err instanceof Error ? err.message : String(err) }))
    .finally(close);

  return sseResponse(stream);
}
