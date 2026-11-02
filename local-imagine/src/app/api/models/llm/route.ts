import { getSettings } from "@/lib/server/store";
import { listOllamaModels } from "@/lib/server/ollama";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  try {
    return json({ models: await listOllamaModels(settings.ollamaUrl) });
  } catch (err) {
    return json({ models: [], error: (err as Error).message });
  }
}
