import { deletePersona, getPersona, updatePersona } from "@/lib/server/store";
import { badRequest, json, notFound, serverError } from "@/lib/server/http";
import { Persona, isValidId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const EDITABLE: Array<keyof Persona> = ["name", "description", "appearance", "style", "negativePrompt", "lora", "triggerWords", "checkpoint", "nsfw"];

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isValidId(id)) return badRequest("Invalid id");
  const persona = await getPersona(id);
  return persona ? json(persona) : notFound("Persona not found");
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!isValidId(id)) return badRequest("Invalid id");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return badRequest("JSON object required");
    // Only editable scalar fields; referenceImages are managed through /refs. `null` clears lora/checkpoint.
    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      if (!(key in body)) continue;
      const v = body[key];
      if (key === "nsfw") {
        if (typeof v !== "boolean") return badRequest("nsfw must be boolean");
      } else if (key === "lora") {
        if (v !== null && (typeof v !== "object" || typeof (v as { name?: unknown }).name !== "string" || typeof (v as { strength?: unknown }).strength !== "number")) {
          return badRequest("lora must be {name, strength} or null");
        }
      } else if (key === "checkpoint") {
        if (v !== null && typeof v !== "string") return badRequest("checkpoint must be a string or null");
      } else if (typeof v !== "string") {
        return badRequest(`${key} must be a string`);
      }
      patch[key] = v;
    }
    const persona = await updatePersona(id, patch as Partial<Persona>);
    return persona ? json(persona) : notFound("Persona not found");
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!isValidId(id)) return badRequest("Invalid id");
    if (!(await getPersona(id))) return notFound("Persona not found");
    await deletePersona(id);
    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}
