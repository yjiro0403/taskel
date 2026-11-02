import path from "path";
import { getPersona, readBinary, removeFile, saveBinary, updatePersona } from "@/lib/server/store";
import { badRequest, json, notFound, safeFileName, serverError } from "@/lib/server/http";
import { newId } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST multipart/form-data with one or more "files" fields, or JSON {"fromGenerated": "<data-relative path>"}
 * to promote a generated image to a reference image.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const persona = await getPersona(id);
    if (!persona) return notFound("Persona not found");

    const added: string[] = [];
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await req.json()) as { fromGenerated?: string };
      if (!body.fromGenerated) return badRequest("fromGenerated required");
      const data = await readBinary(body.fromGenerated);
      const rel = `personas/${id}/refs/${newId("ref_")}${path.extname(body.fromGenerated) || ".png"}`;
      await saveBinary(rel, data);
      added.push(rel);
    } else {
      const form = await req.formData();
      for (const entry of form.getAll("files")) {
        if (!(entry instanceof File)) continue;
        if (!entry.type.startsWith("image/")) continue;
        const ext = path.extname(safeFileName(entry.name)) || ".png";
        const rel = `personas/${id}/refs/${newId("ref_")}${ext}`;
        await saveBinary(rel, Buffer.from(await entry.arrayBuffer()));
        added.push(rel);
      }
    }
    if (!added.length) return badRequest("No image files received");
    const updated = await updatePersona(id, { referenceImages: [...persona.referenceImages, ...added] });
    return json(updated);
  } catch (err) {
    return serverError(err);
  }
}

/** DELETE ?file=<data-relative path> */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const file = new URL(req.url).searchParams.get("file");
    const persona = await getPersona(id);
    if (!persona) return notFound("Persona not found");
    if (!file || !persona.referenceImages.includes(file)) return badRequest("Unknown reference image");
    await removeFile(file);
    const updated = await updatePersona(id, { referenceImages: persona.referenceImages.filter((f) => f !== file) });
    return json(updated);
  } catch (err) {
    return serverError(err);
  }
}
