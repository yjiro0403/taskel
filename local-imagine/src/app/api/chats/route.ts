import { createChat, getPersona, listChats } from "@/lib/server/store";
import { badRequest, json, notFound, serverError } from "@/lib/server/http";
import { isValidId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const personaId = new URL(req.url).searchParams.get("personaId") ?? undefined;
    if (personaId !== undefined && !isValidId(personaId)) return badRequest("Invalid personaId");
    return json({ chats: await listChats(personaId) });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { personaId?: unknown; title?: unknown } | null;
    if (!body || !isValidId(body.personaId)) return badRequest("personaId required");
    if (!(await getPersona(body.personaId))) return notFound("Persona not found");
    const title = typeof body.title === "string" ? body.title.slice(0, 200) : undefined;
    return json(await createChat(body.personaId, title), { status: 201 });
  } catch (err) {
    return serverError(err);
  }
}
