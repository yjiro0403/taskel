import { getSettings, saveSettings } from "@/lib/server/store";
import { json, serverError } from "@/lib/server/http";
import { Settings } from "@/lib/types";

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
    const patch = (await req.json()) as Partial<Settings>;
    return json(await saveSettings(patch));
  } catch (err) {
    return serverError(err);
  }
}
