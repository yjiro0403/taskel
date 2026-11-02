import { createChat, getPersona, listChats } from "@/lib/server/store";
import { badRequest, json, notFound, serverError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const personaId = new URL(req.url).searchParams.get("personaId") ?? undefined;
    return json({ chats: await listChats(personaId) });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { personaId?: string; title?: string };
    if (!body.personaId) return badRequest("personaId required");
    if (!(await getPersona(body.personaId))) return notFound("Persona not found");
    return json(await createChat(body.personaId, body.title), { status: 201 });
  } catch (err) {
    return serverError(err);
  }
}
