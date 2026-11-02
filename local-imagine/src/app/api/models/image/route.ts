import { getSettings } from "@/lib/server/store";
import { getImageModelCatalog } from "@/lib/server/comfy";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const settings = await getSettings();
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  try {
    return json({ catalog: await getImageModelCatalog(settings.comfyUrl, force) });
  } catch (err) {
    return json({ catalog: null, error: (err as Error).message });
  }
}
