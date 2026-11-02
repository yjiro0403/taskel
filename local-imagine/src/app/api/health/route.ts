import { getSettings, DATA_DIR, ensureDataDir } from "@/lib/server/store";
import { ollamaVersion } from "@/lib/server/ollama";
import { systemStats } from "@/lib/server/comfy";
import { json } from "@/lib/server/http";
import { HealthStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDataDir();
  const settings = await getSettings();
  const status: HealthStatus = { ollama: { ok: false }, comfy: { ok: false }, dataDir: DATA_DIR };
  await Promise.all([
    ollamaVersion(settings.ollamaUrl)
      .then((v) => (status.ollama = { ok: true, version: v }))
      .catch((e) => (status.ollama = { ok: false, error: (e as Error).message })),
    systemStats(settings.comfyUrl)
      .then((s) => {
        const dev = s.devices?.[0];
        status.comfy = {
          ok: true,
          device: dev ? `${dev.name} (${dev.type})` : undefined,
          vramTotal: dev?.vram_total,
          vramFree: dev?.vram_free,
          pythonVersion: s.system?.python_version,
        };
      })
      .catch((e) => (status.comfy = { ok: false, error: (e as Error).message })),
  ]);
  return json(status);
}
