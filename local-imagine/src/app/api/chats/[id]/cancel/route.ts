import { cancelTurn } from "@/lib/server/jobs";
import { getSettings } from "@/lib/server/store";
import { interrupt } from "@/lib/server/comfy";
import { badRequest, json } from "@/lib/server/http";
import { isValidId } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Cancel the running turn for this chat. The turn marks its batches as cancelled and ends the
 * SSE stream normally, so the client sees consistent state instead of a half-written chat.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isValidId(id)) return badRequest("Invalid id");
  const cancelled = cancelTurn(id);
  if (cancelled) {
    try {
      await interrupt((await getSettings()).comfyUrl);
    } catch {
      /* ComfyUI may be down */
    }
  }
  return json({ cancelled });
}
