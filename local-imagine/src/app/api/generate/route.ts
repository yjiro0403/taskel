import { getChat as getChatById, getSettings } from "@/lib/server/store";
import { runDirectGeneration } from "@/lib/server/agent";
import { beginTurn, endTurn, isTurnRunning } from "@/lib/server/jobs";
import { createSse, sseResponse } from "@/lib/server/sse";
import { badRequest, notFound } from "@/lib/server/http";
import { directGenerateSchema, isAppImagePath } from "@/lib/server/validation";
import { AspectRatio, GenParams, isValidId } from "@/lib/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/**
 * Direct generation without the LLM (variations / regenerate / manual prompt / video).
 * POST { chatId, prompt, negativePrompt?, params?: Partial<GenParams> & { aspect? }, compose?: boolean, note?: string }
 */
export async function POST(req: Request) {
  const parsed = directGenerateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const body = parsed.data;
  if (!isValidId(body.chatId)) return badRequest("Invalid chatId");
  if (!(await getChatById(body.chatId))) return notFound("Chat not found");
  if (isTurnRunning(body.chatId)) return NextResponse.json({ error: "このチャットは生成中です。" }, { status: 409 });
  const settings = await getSettings();

  // Image paths must be ones this app produced
  const params = { ...(body.params ?? {}) } as Partial<GenParams> & { aspect?: AspectRatio };
  if (params.referenceImages) params.referenceImages = params.referenceImages.filter(isAppImagePath);
  if (params.initImage && !isAppImagePath(params.initImage)) delete params.initImage;

  const { stream, send, close } = createSse();
  const controller = beginTurn(body.chatId, req.signal);
  void runDirectGeneration({
    chatId: body.chatId,
    prompt: body.prompt,
    negativePrompt: body.negativePrompt,
    params,
    compose: body.compose ?? true,
    note: body.note,
    settings,
    send,
    signal: controller.signal,
  })
    .catch((err) => send({ type: "error", error: err instanceof Error ? err.message : String(err) }))
    .finally(() => {
      endTurn(body.chatId, controller);
      close();
    });
  return sseResponse(stream);
}


