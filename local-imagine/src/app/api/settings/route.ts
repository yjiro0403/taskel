import { getSettings, saveSettings } from "@/lib/server/store";
import { badRequest, json, serverError } from "@/lib/server/http";
import { parseSettingsPatch } from "@/lib/server/validation";

export const runtime = "nodejs";

export async function GET() {
  try {
    return json(await getSettings());
  } catch (err) {
    return serverError(err);
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("JSON object required");
    const parsed = parseSettingsPatch(body);
    if (!parsed.ok) return badRequest(parsed.error);
    return json(await saveSettings(parsed.data));
  } catch (err) {
    return serverError(err);
  }
}
