import { getChat, saveBinary } from "@/lib/server/store";
import { badRequest, json, notFound, serverError } from "@/lib/server/http";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES, sniffImageExt } from "@/lib/server/validation";
import { newId } from "@/lib/ids";
import { isValidId } from "@/lib/types";

export const runtime = "nodejs";

/** POST multipart: chatId + files[] -> { files: string[] } (data-relative paths) */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const chatId = String(form.get("chatId") ?? "");
    if (!isValidId(chatId)) return badRequest("Invalid chatId");
    if (!(await getChat(chatId))) return notFound("Chat not found");
    const files: string[] = [];
    const entries = form.getAll("files").filter((e): e is File => e instanceof File).slice(0, MAX_UPLOAD_FILES);
    for (const entry of entries) {
      if (entry.size > MAX_UPLOAD_BYTES) return badRequest(`${entry.name}: file too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`);
      const data = Buffer.from(await entry.arrayBuffer());
      const ext = sniffImageExt(data);
      if (!ext) continue;
      const rel = `uploads/${chatId}/${newId("u_")}${ext}`;
      await saveBinary(rel, data);
      files.push(rel);
    }
    if (!files.length) return badRequest("No image files received (png / jpeg / webp / gif)");
    return json({ files });
  } catch (err) {
    return serverError(err);
  }
}
