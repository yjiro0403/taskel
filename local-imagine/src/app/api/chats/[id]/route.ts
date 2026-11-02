import { deleteChat, getChat, mutateChat } from "@/lib/server/store";
import { json, notFound, serverError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const chat = await getChat(id);
  return chat ? json(chat) : notFound("Chat not found");
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { title?: string };
    const chat = await mutateChat(id, (c) => {
      if (typeof body.title === "string" && body.title.trim()) c.title = body.title.trim();
    });
    return chat ? json(chat) : notFound("Chat not found");
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteChat(id);
    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}
