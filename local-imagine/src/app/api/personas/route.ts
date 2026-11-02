import { createPersona, listPersonas } from "@/lib/server/store";
import { json, serverError } from "@/lib/server/http";
import { Persona } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ personas: await listPersonas() });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<Persona>;
    return json(await createPersona(body), { status: 201 });
  } catch (err) {
    return serverError(err);
  }
}
