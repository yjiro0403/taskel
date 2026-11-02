import { getSettings } from "@/lib/server/store";
import { interrupt } from "@/lib/server/comfy";
import { json, serverError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST() {
  try {
    const settings = await getSettings();
    await interrupt(settings.comfyUrl);
    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}
