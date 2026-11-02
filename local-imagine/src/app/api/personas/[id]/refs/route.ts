import path from "path";
import { getPersona, mutatePersona, readBinary, removeFile, saveBinary } from "@/lib/server/store";
import { badRequest, json, notFound, serverError } from "@/lib/server/http";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES, isAppImagePath, sniffImageExt } from "@/lib/server/validation";
import { newId } from "@/lib/ids";
import { isValidId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST multipart/form-data with one or more "files" fields, or JSON {"fromGenerated": "<data-relative path>"}
 * to promote a generated/uploaded image to a reference image.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!isValidId(id)) return badRequest("Invalid id");
    if (!(await getPersona(id))) return notFound("Persona not found");

    const added: string[] = [];
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as { fromGenerated?: unknown } | null;
      if (!body || !isAppImagePath(body.fromGenerated)) return badRequest("fromGenerated must be an image generated or uploaded by this app");
      const data = await readBinary(body.fromGenerated);
      const ext = sniffImageExt(data) ?? path.extname(body.fromGenerated);
      const rel = `personas/${id}/refs/${newId("ref_")}${ext}`;
      await saveBinary(rel, data);
      added.push(rel);
    } else {
      const form = await req.formData();
      const files = form.getAll("files").filter((e): e is File => e instanceof File).slice(0, MAX_UPLOAD_FILES);
      for (const entry of files) {
        if (entry.size > MAX_UPLOAD_BYTES) return badRequest(`${entry.name}: file too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`);
        const data = Buffer.from(await entry.arrayBuffer());
        const ext = sniffImageExt(data);
        if (!ext) continue; // not an image we support
        const rel = `personas/${id}/refs/${newId("ref_")}${ext}`;
        await saveBinary(rel, data);
        added.push(rel);
      }
    }
    if (!added.length) return badRequest("No image files received (png / jpeg / webp / gif)");
    const updated = await mutatePersona(id, (p) => {
      p.referenceImages = [...p.referenceImages, ...added];
    });
    return updated ? json(updated) : notFound("Persona not found");
  } catch (err) {
    return serverError(err);
  }
}

/** DELETE ?file=<data-relative path> */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!isValidId(id)) return badRequest("Invalid id");
    const file = new URL(req.url).searchParams.get("file");
    if (!file) return badRequest("file required");
    let known = false;
    const updated = await mutatePersona(id, (p) => {
      known = p.referenceImages.includes(file);
      p.referenceImages = p.referenceImages.filter((f) => f !== file);
    });
    if (!updated) return notFound("Persona not found");
    if (!known) return badRequest("Unknown reference image");
    await removeFile(file);
    return json(updated);
  } catch (err) {
    return serverError(err);
  }
}
