import { AgentPlan, Chat, Message, Persona, Settings, StreamEvent, guessCheckpointFamily } from "@/lib/types";
import { newId, nowIso } from "@/lib/ids";
import { OllamaMessage, ollamaChat, ollamaChatJson } from "./ollama";
import * as comfy from "./comfy";
import { getChat, getPersona, mutateChat, readBinary } from "./store";
import { AGENT_PLAN_SCHEMA, VISION_DESCRIBE_PROMPT, assistantTurnToJson, buildSystemPrompt, composeNegative, composePositive } from "./prompts";
import { newBatch, resolveParams, runBatch } from "./generate";

/**
 * One conversational turn:
 *   user text (+ attachments) -> local LLM plans reply + generations (structured JSON)
 *   -> ComfyUI renders each batch -> events streamed to the client -> everything persisted.
 */

export interface ChatTurnInput {
  chatId: string;
  content: string;
  /** data-relative paths already saved under uploads/<chatId>/ */
  attachments: string[];
  settings: Settings;
  send: (e: StreamEvent) => void;
  signal?: AbortSignal;
}

function historyToOllama(chat: Chat, limit: number): OllamaMessage[] {
  const msgs = limit > 0 ? chat.messages.slice(-limit) : [];
  const out: OllamaMessage[] = [];
  for (const m of msgs) {
    if (m.role === "user") {
      const att = m.attachments?.length ? `\n[user attached ${m.attachments.length} image(s)]` : "";
      out.push({ role: "user", content: m.content + att });
    } else {
      const plan: AgentPlan = {
        reply: m.content,
        generations: (m.generations ?? []).map((g) => ({
          // Feed back what the model wrote, not the composed prompt (which carries injected identity/quality tags)
          prompt: g.scenePrompt ?? g.prompt,
          negative_prompt: g.sceneNegative ?? g.negativePrompt,
          count: g.params.batchCount,
          aspect: g.aspect ?? aspectFromSize(g.params.width, g.params.height),
          use_reference_images: g.params.referenceImages.length > 0,
        })),
      };
      out.push({ role: "assistant", content: assistantTurnToJson(plan) });
    }
  }
  return out;
}

function aspectFromSize(w: number, h: number): AgentPlan["generations"][number]["aspect"] {
  const r = w / h;
  const table: Array<[number, AgentPlan["generations"][number]["aspect"]]> = [
    [1, "1:1"], [3 / 4, "3:4"], [4 / 3, "4:3"], [2 / 3, "2:3"], [3 / 2, "3:2"], [9 / 16, "9:16"], [16 / 9, "16:9"],
  ];
  return table.reduce((best, cur) => (Math.abs(cur[0] - r) < Math.abs(best[0] - r) ? cur : best))[1];
}

async function describeAttachments(settings: Settings, attachments: string[], signal?: AbortSignal): Promise<string | null> {
  if (!settings.visionModel || attachments.length === 0) return null;
  const images: string[] = [];
  for (const rel of attachments.slice(0, 4)) {
    images.push((await readBinary(rel)).toString("base64"));
  }
  const res = await ollamaChat(settings.ollamaUrl, {
    model: settings.visionModel,
    messages: [{ role: "user", content: VISION_DESCRIBE_PROMPT, images }],
    options: { temperature: 0.2, num_ctx: settings.llmNumCtx },
    keep_alive: settings.llmKeepAlive,
    signal,
    timeoutMs: 10 * 60 * 1000,
  });
  return res.message.content.trim();
}

export async function runChatTurn(input: ChatTurnInput): Promise<void> {
  const { chatId, settings, send, signal } = input;
  const chat = await getChat(chatId);
  if (!chat) {
    send({ type: "error", error: "Chat not found" });
    return;
  }
  const persona = await getPersona(chat.personaId);
  const checkpoint = persona?.checkpoint || settings.checkpoint;
  const nsfw = settings.nsfwAllowed && !!persona?.nsfw;

  // 1. persist the user message
  const userMessage: Message = {
    id: newId("m_"),
    role: "user",
    content: input.content,
    attachments: input.attachments.length ? input.attachments : undefined,
    createdAt: nowIso(),
  };
  await mutateChat(chatId, (c) => {
    c.messages.push(userMessage);
    if (c.messages.length === 1 || c.title === "新しいチャット") {
      c.title = input.content.trim().slice(0, 32) || c.title;
    }
  });
  send({ type: "user_message", message: userMessage });

  // 2. optional: let a vision model look at attachments
  let attachmentNote = "";
  if (input.attachments.length) {
    if (settings.visionModel) {
      send({ type: "status", text: `添付画像を ${settings.visionModel} で解析中…` });
      try {
        const desc = await describeAttachments(settings, input.attachments, signal);
        if (desc) attachmentNote = `\n\n[Attached image description by vision model]: ${desc}`;
      } catch (err) {
        send({ type: "status", text: `画像解析に失敗しました: ${(err as Error).message}` });
      }
    } else {
      attachmentNote = `\n\n[${input.attachments.length} image(s) attached; no vision model configured, so you cannot see them. They will be used as IP-Adapter references when use_reference_images is true.]`;
    }
  }

  // 3. ask the LLM for a plan
  let ipAdapterAvailable = false;
  try {
    ipAdapterAvailable = (await comfy.getImageModelCatalog(settings.comfyUrl)).hasIPAdapter;
  } catch {
    /* ComfyUI down: the generation step will report it */
  }
  const system = buildSystemPrompt({
    persona,
    settings,
    checkpoint,
    hasReferenceImages: (persona?.referenceImages.length ?? 0) + input.attachments.length > 0,
    ipAdapterAvailable,
    nsfw,
  });
  const history = historyToOllama({ ...chat, messages: chat.messages }, settings.historyLimit);
  const messages: OllamaMessage[] = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: input.content + attachmentNote },
  ];

  send({ type: "status", text: `${settings.llmModel} が考え中…` });
  let plan: AgentPlan;
  try {
    if (!settings.llmModel) throw new Error("LLM モデルが選択されていません。上部のモデル選択から Ollama のモデルを選んでください。");
    const { data } = await ollamaChatJson<AgentPlan>(settings.ollamaUrl, {
      model: settings.llmModel,
      messages,
      format: AGENT_PLAN_SCHEMA as unknown as Record<string, unknown>,
      options: { temperature: settings.temperature, num_ctx: settings.llmNumCtx },
      think: false,
      keep_alive: settings.llmKeepAlive,
      signal,
    });
    plan = normalisePlan(data, settings);
  } catch (err) {
    if (signal?.aborted) {
      // User cancelled while the model was thinking: nothing to persist.
      send({ type: "done" });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    const failed: Message = { id: newId("m_"), role: "assistant", content: "", error: msg, createdAt: nowIso(), model: settings.llmModel };
    await mutateChat(chatId, (c) => void c.messages.push(failed));
    send({ type: "assistant_message", message: failed });
    send({ type: "error", error: msg, messageId: failed.id });
    send({ type: "done", messageId: failed.id });
    return;
  }

  // 4. build batches
  const family = guessCheckpointFamily(checkpoint);
  const assistant: Message = {
    id: newId("m_"),
    role: "assistant",
    content: plan.reply,
    createdAt: nowIso(),
    model: settings.llmModel,
    generations: plan.generations.map((g) => {
      const refs = g.use_reference_images ? [...(persona?.referenceImages ?? []), ...input.attachments] : [];
      const params = resolveParams(settings, persona, { aspect: g.aspect, count: g.count, referenceImages: refs });
      const batch = newBatch(composePositive(persona, g.prompt, family, nsfw), composeNegative(persona, g.negative_prompt, family), params);
      batch.scenePrompt = g.prompt;
      batch.sceneNegative = g.negative_prompt;
      batch.aspect = g.aspect;
      return batch;
    }),
  };
  await mutateChat(chatId, (c) => void c.messages.push(assistant));
  send({ type: "assistant_message", message: assistant });

  // 5. render sequentially (one GPU); whatever is left after an abort/error must not stay "queued"
  await renderBatches({ chatId, messageId: assistant.id, settings, persona, send, signal }, assistant.generations ?? []);
  send({ type: "done", messageId: assistant.id });
}

async function renderBatches(ctx: Parameters<typeof runBatch>[0], batches: Message["generations"] & object): Promise<void> {
  let failure: string | null = null;
  for (const batch of batches) {
    if (ctx.signal?.aborted || failure) {
      batch.status = ctx.signal?.aborted ? "cancelled" : "error";
      if (failure) batch.error = failure;
      ctx.send({ type: "batch_end", messageId: ctx.messageId, batch });
      continue;
    }
    try {
      await runBatch(ctx, batch);
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      batch.status = "error";
      batch.error = failure;
      ctx.send({ type: "batch_end", messageId: ctx.messageId, batch });
    }
  }
  const skipped = batches.filter((b) => b.status === "cancelled" || (b.status === "error" && b.error === failure));
  if (skipped.length) {
    await mutateChat(ctx.chatId, (chat) => {
      const m = chat.messages.find((x) => x.id === ctx.messageId);
      for (const b of skipped) {
        const g = m?.generations?.find((x) => x.id === b.id);
        if (g && (g.status === "queued" || g.status === "running")) {
          g.status = b.status;
          g.error = b.error;
        }
      }
    });
  }
}

function normalisePlan(raw: AgentPlan, settings: Settings): AgentPlan {
  const gens = Array.isArray(raw?.generations) ? raw.generations : [];
  return {
    reply: typeof raw?.reply === "string" ? raw.reply : "",
    generations: gens
      .filter((g) => g && typeof g.prompt === "string" && g.prompt.trim())
      .slice(0, 4)
      .map((g) => ({
        prompt: g.prompt.trim(),
        negative_prompt: typeof g.negative_prompt === "string" ? g.negative_prompt : "",
        count: Math.min(8, Math.max(1, Number(g.count) || settings.defaults.batchCount)),
        aspect: (["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"] as const).includes(g.aspect) ? g.aspect : "2:3",
        use_reference_images: Boolean(g.use_reference_images),
      })),
  };
}

/**
 * Direct (non-LLM) generation used by "variations", "regenerate" and the manual prompt box.
 * Appends an assistant message with a single batch to the chat.
 */
export interface DirectGenerationInput {
  chatId: string;
  prompt: string;
  negativePrompt?: string;
  params: Partial<import("@/lib/types").GenParams> & { aspect?: import("@/lib/types").AspectRatio };
  /** When true the persona identity / quality tags are composed around the prompt; false = raw prompt */
  compose: boolean;
  note?: string;
  settings: Settings;
  send: (e: StreamEvent) => void;
  signal?: AbortSignal;
}

export async function runDirectGeneration(input: DirectGenerationInput): Promise<void> {
  const { chatId, settings, send, signal } = input;
  const chat = await getChat(chatId);
  if (!chat) {
    send({ type: "error", error: "Chat not found" });
    return;
  }
  const persona: Persona | null = await getPersona(chat.personaId);
  const nsfw = settings.nsfwAllowed && !!persona?.nsfw;
  const base = resolveParams(settings, persona, {
    aspect: input.params.aspect,
    count: input.params.batchCount,
    referenceImages: input.params.referenceImages,
    mode: input.params.mode,
    initImage: input.params.initImage,
    denoise: input.params.denoise,
    seed: input.params.seed,
  });
  // input.params is validated by directParamsSchema in the route; aspect is consumed by resolveParams.
  const { aspect: _aspect, ...overrides } = stripUndefined(input.params);
  void _aspect;
  const params = { ...base, ...overrides };
  const family = guessCheckpointFamily(params.checkpoint);
  const positive = input.compose ? composePositive(persona, input.prompt, family, nsfw) : input.prompt;
  const negative = input.compose ? composeNegative(persona, input.negativePrompt ?? "", family) : input.negativePrompt ?? "";

  const assistant: Message = {
    id: newId("m_"),
    role: "assistant",
    content: input.note ?? "",
    createdAt: nowIso(),
    generations: [newBatch(positive, negative, params)],
  };
  await mutateChat(chatId, (c) => void c.messages.push(assistant));
  send({ type: "assistant_message", message: assistant });
  await renderBatches({ chatId, messageId: assistant.id, settings, persona, send, signal }, assistant.generations!);
  send({ type: "done", messageId: assistant.id });
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
