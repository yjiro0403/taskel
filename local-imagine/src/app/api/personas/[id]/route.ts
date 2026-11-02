import { deletePersona, getPersona, updatePersona } from "@/lib/server/store";
import { json, notFound, serverError } from "@/lib/server/http";
import { Persona } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const persona = await getPersona(id);
  return persona ? json(persona) : notFound("Persona not found");
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const patch = (await req.json()) as Partial<Persona>;
    // referenceImages are managed through /refs
    delete patch.referenceImages;
    const persona = await updatePersona(id, patch);
    return persona ? json(persona) : notFound("Persona not found");
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deletePersona(id);
    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}
