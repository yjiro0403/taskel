import { getChat, getSettings } from "@/lib/server/store";
import { runChatTurn } from "@/lib/server/agent";
import { beginTurn, endTurn, isTurnRunning } from "@/lib/server/jobs";
import { createSse, sseResponse } from "@/lib/server/sse";
import { badRequest, notFound } from "@/lib/server/http";
import { chatMessageSchema, isAppImagePath } from "@/lib/server/validation";
import { isValidId } from "@/lib/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Generation can take many minutes on an M1
export const maxDuration = 3600;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST { content: string, attachments?: string[] }  -> text/event-stream of StreamEvent
 * Attachments are data-relative paths returned by POST /api/uploads for this chat.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isValidId(id)) return badRequest("Invalid id");
  const parsed = chatMessageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("content required");
  const attachments = (parsed.data.attachments ?? []).filter((a) => isAppImagePath(a) && a.startsWith(`uploads/${id}/`));
  if (!parsed.data.content.trim() && !attachments.length) return badRequest("content required");
  if (!(await getChat(id))) return notFound("Chat not found");
  if (isTurnRunning(id)) return NextResponse.json({ error: "このチャットは生成中です。完了または中止してから送信してください。" }, { status: 409 });
  const settings = await getSettings();

  const { stream, send, close } = createSse();
  const controller = beginTurn(id, req.signal);

  void runChatTurn({ chatId: id, content: parsed.data.content, attachments, settings, send, signal: controller.signal })
    .catch((err) => send({ type: "error", error: err instanceof Error ? err.message : String(err) }))
    .finally(() => {
      endTurn(id, controller);
      close();
    });

  return sseResponse(stream);
}
