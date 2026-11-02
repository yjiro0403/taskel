import path from "path";
import { getChat, saveBinary } from "@/lib/server/store";
import { badRequest, json, notFound, safeFileName, serverError } from "@/lib/server/http";
import { newId } from "@/lib/ids";

export const runtime = "nodejs";

/** POST multipart: chatId + files[] -> { files: string[] } (data-relative paths) */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const chatId = String(form.get("chatId") ?? "");
    if (!chatId || !(await getChat(chatId))) return notFound("Chat not found");
    const files: string[] = [];
    for (const entry of form.getAll("files")) {
      if (!(entry instanceof File) || !entry.type.startsWith("image/")) continue;
      const ext = path.extname(safeFileName(entry.name)) || ".png";
      const rel = `uploads/${chatId}/${newId("u_")}${ext}`;
      await saveBinary(rel, Buffer.from(await entry.arrayBuffer()));
      files.push(rel);
    }
    if (!files.length) return badRequest("No image files received");
    return json({ files });
  } catch (err) {
    return serverError(err);
  }
}
