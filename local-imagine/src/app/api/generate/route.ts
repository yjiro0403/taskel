import { getChat, getSettings } from "@/lib/server/store";
import { runDirectGeneration } from "@/lib/server/agent";
import { createSse, sseResponse } from "@/lib/server/sse";
import { badRequest, notFound } from "@/lib/server/http";
import { AspectRatio, GenParams } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/**
 * Direct generation without the LLM (variations / regenerate / manual prompt / video).
 * POST { chatId, prompt, negativePrompt?, params?: Partial<GenParams> & { aspect? }, compose?: boolean, note?: string }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    chatId?: string;
    prompt?: string;
    negativePrompt?: string;
    params?: Partial<GenParams> & { aspect?: AspectRatio };
    compose?: boolean;
    note?: string;
  } | null;
  if (!body?.chatId || typeof body.prompt !== "string" || !body.prompt.trim()) return badRequest("chatId and prompt required");
  if (!(await getChat(body.chatId))) return notFound("Chat not found");
  const settings = await getSettings();

  const { stream, send, close } = createSse();
  void runDirectGeneration({
    chatId: body.chatId,
    prompt: body.prompt,
    negativePrompt: body.negativePrompt,
    params: body.params ?? {},
    compose: body.compose ?? true,
    note: body.note,
    settings,
    send,
    signal: req.signal,
  })
    .catch((err) => send({ type: "error", error: err instanceof Error ? err.message : String(err) }))
    .finally(close);
  return sseResponse(stream);
}
