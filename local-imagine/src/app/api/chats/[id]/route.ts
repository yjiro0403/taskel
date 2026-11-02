import { deleteChat, getChat, mutateChat, saveChat } from "@/lib/server/store";
import { cancelTurn, isTurnRunning, reconcileStaleBatches } from "@/lib/server/jobs";
import { badRequest, json, notFound, serverError } from "@/lib/server/http";
import { isValidId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!isValidId(id)) return badRequest("Invalid id");
    const chat = await getChat(id);
    if (!chat) return notFound("Chat not found");
    // Batches left "running" by a crash/restart are turned into errors so the UI stops spinning.
    if (reconcileStaleBatches(chat)) await saveChat(chat);
    return json({ ...chat, generating: isTurnRunning(id) });
  } catch (err) {
    return serverError(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!isValidId(id)) return badRequest("Invalid id");
    const body = (await req.json().catch(() => null)) as { title?: unknown } | null;
    const chat = await mutateChat(id, (c) => {
      if (typeof body?.title === "string" && body.title.trim()) c.title = body.title.trim().slice(0, 200);
    });
    return chat ? json(chat) : notFound("Chat not found");
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!isValidId(id)) return badRequest("Invalid id");
    if (!(await getChat(id))) return notFound("Chat not found");
    cancelTurn(id);
    await deleteChat(id);
    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}
