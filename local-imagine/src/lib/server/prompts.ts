import {
  AgentPlan,
  ASPECT_RATIOS,
  CheckpointFamily,
  Persona,
  PromptStyle,
  Settings,
  guessCheckpointFamily,
} from "@/lib/types";

/** JSON schema handed to Ollama's `format` so every model returns the same plan shape. */
export const AGENT_PLAN_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "Conversational reply to the user, in the user's language." },
    generations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          negative_prompt: { type: "string" },
          count: { type: "integer", minimum: 1, maximum: 8 },
          aspect: { type: "string", enum: ASPECT_RATIOS },
          use_reference_images: { type: "boolean" },
        },
        required: ["prompt", "negative_prompt", "count", "aspect", "use_reference_images"],
      },
    },
  },
  required: ["reply", "generations"],
} as const;

export function effectivePromptStyle(style: PromptStyle, family: CheckpointFamily): "tags" | "natural" {
  if (style !== "auto") return style;
  return family === "flux" || family === "sdxl" || family === "unknown" ? "natural" : "tags";
}

export function qualityPrefix(family: CheckpointFamily, nsfw: boolean): string {
  switch (family) {
    case "pony":
      return `score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up, ${nsfw ? "rating_explicit" : "rating_safe"}, `;
    case "illustrious":
      return "masterpiece, best quality, very aesthetic, absurdres, ";
    case "sd15":
      return "masterpiece, best quality, highly detailed, ";
    default:
      return "";
  }
}

export function defaultNegative(family: CheckpointFamily): string {
  switch (family) {
    case "pony":
      return "score_6, score_5, score_4, worst quality, low quality, bad anatomy, bad hands, text, watermark, signature";
    case "illustrious":
      return "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry";
    case "flux":
      return "";
    default:
      return "lowres, bad anatomy, bad hands, text, watermark, worst quality, low quality, deformed, blurry, extra limbs";
  }
}

/** Final positive prompt: identity tokens are injected deterministically so the LLM cannot drop them. */
export function composePositive(persona: Persona | null, scenePrompt: string, family: CheckpointFamily, nsfw: boolean): string {
  const parts = [
    persona?.lora && persona.triggerWords ? persona.triggerWords : "",
    qualityPrefix(family, nsfw),
    persona?.appearance ?? "",
    scenePrompt,
    persona?.style ?? "",
  ]
    .map((s) => s.trim().replace(/,\s*$/, ""))
    .filter(Boolean);
  return dedupeTags(parts.join(", "));
}

/** Remove exact duplicate comma-separated tags (case-insensitive), keeping the first occurrence. */
export function dedupeTags(text: string): string {
  const seen = new Set<string>();
  return text
    .split(/,\s*/)
    .filter((t) => {
      const k = t.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(", ");
}

export function composeNegative(persona: Persona | null, sceneNegative: string, family: CheckpointFamily): string {
  const parts = [defaultNegative(family), persona?.negativePrompt ?? "", sceneNegative]
    .map((s) => s.trim().replace(/,\s*$/, ""))
    .filter(Boolean);
  return dedupeTags(parts.join(", "));
}

export interface SystemPromptInput {
  persona: Persona | null;
  settings: Settings;
  checkpoint: string;
  hasReferenceImages: boolean;
  ipAdapterAvailable: boolean;
  nsfw: boolean;
  attachmentNote?: string;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const { persona, settings, checkpoint, hasReferenceImages, ipAdapterAvailable, nsfw } = input;
  const family = guessCheckpointFamily(checkpoint);
  const style = effectivePromptStyle(settings.promptStyle, family);

  const langRule =
    settings.language === "ja"
      ? "Always write `reply` in Japanese."
      : settings.language === "en"
        ? "Always write `reply` in English."
        : "Write `reply` in the same language the user writes in (Japanese if they write Japanese).";

  const promptStyleRule =
    style === "tags"
      ? `PROMPT STYLE = Danbooru-style tags. Write \`prompt\` as comma-separated English tags, most important first: subject count (1girl / 1boy / solo), pose, expression, outfit (be specific: colour, material, cut), hair motion, hands, camera angle (from above, from side, dutch angle), framing (full body, cowboy shot, upper body, close-up), background/location, lighting, mood. 20-45 tags. No sentences, no quality tags (they are added automatically), no character identity tags (hair/eye colour, body) — those are injected from the persona sheet.`
      : `PROMPT STYLE = natural language. Write \`prompt\` as one or two vivid English sentences (60-120 words) describing pose, expression, outfit (be specific), camera angle and framing, setting, lighting and mood. Do not describe the character's fixed identity (hair/eye colour, body) — that is injected automatically from the persona sheet. No quality boilerplate.`;

  const nsfwRule = nsfw
    ? `CONTENT POLICY: Adult/NSFW content is permitted in this persona's chats. The character is an adult (21+). Hard limits that you must never cross regardless of the request: no minors or anyone described as or appearing underage (no "loli", school-child framing, etc.), no real identifiable people, no sexual violence. If a request crosses a hard limit, refuse briefly in \`reply\` and return no generations.`
    : `CONTENT POLICY: Keep every image safe-for-work (no nudity or sexual content). If the user asks for explicit content, say NSFW is disabled in settings and offer a tasteful alternative.`;

  const personaBlock = persona
    ? `## Persona: ${persona.name}
Character sheet (personality, background, wardrobe, what they like):
${persona.description || "(none)"}

Fixed visual identity (injected automatically into every prompt — do NOT repeat it): ${persona.appearance || "(none)"}
Art style (injected automatically): ${persona.style || "(none)"}
${hasReferenceImages ? `Reference images: ${persona.referenceImages.length} uploaded. ${ipAdapterAvailable ? "They can be fed to IP-Adapter; set use_reference_images=true to keep the face/identity consistent (recommended for most requests)." : "IP-Adapter is NOT installed in ComfyUI, so reference images cannot be used yet; always set use_reference_images=false."}` : "Reference images: none."}`
    : "## Persona: none (free-form session)";

  return `You are "Local Imagine", an image director for a local image generation studio. You chat with the user and turn their wishes into image generation plans. Everything runs on the user's own machine.

${personaBlock}

## Generation backend
Checkpoint: ${checkpoint || "(not set)"} (family: ${family}). Default images per request: ${settings.defaults.batchCount}.
${promptStyleRule}
\`negative_prompt\`: short, scene-specific things to avoid (e.g. "extra fingers, text"); general quality negatives are added automatically. Can be empty.
\`aspect\`: one of ${ASPECT_RATIOS.join(", ")} — choose from the framing (portrait → 2:3 or 3:4, landscape/scenery → 3:2 or 16:9, square → 1:1).
\`count\`: how many images (1-8). Use the user's number if given, otherwise ${settings.defaults.batchCount}.

## Behaviour
- When the user wants images (explicitly, or implicitly like "show me her at the beach"), return 1-3 generation entries. Different entries = different ideas (e.g. two outfits); the same entry with count>1 = variations of one idea.
- "Another pose / outfit / angle" means: keep everything else from the previous generation and change only what was asked. Re-use the previous prompt as a base.
- When the user just chats (greetings, questions about the character, feedback), return an empty generations array and respond in character as the director, briefly.
- Keep \`reply\` short (1-3 sentences): what you are generating and why, or a question if the request is ambiguous. Do not paste the raw prompt in the reply.
- Prefer variety across images: vary pose, expression and camera angle unless the user asked for consistency.
- The user may attach images; treat them as references for identity/outfit/pose as described in the message.
${nsfwRule}
${langRule}

## Output
Respond ONLY with JSON matching this shape (no markdown):
{"reply": string, "generations": [{"prompt": string, "negative_prompt": string, "count": number, "aspect": "2:3", "use_reference_images": boolean}]}`;
}

/** Compact JSON representation of a previous assistant turn, kept in the same format the model emits. */
export function assistantTurnToJson(plan: AgentPlan): string {
  return JSON.stringify({
    reply: plan.reply,
    generations: plan.generations.map((g) => ({
      prompt: g.prompt,
      negative_prompt: g.negative_prompt,
      count: g.count,
      aspect: g.aspect,
      use_reference_images: g.use_reference_images,
    })),
  });
}

export const VISION_DESCRIBE_PROMPT = `Describe the attached image(s) for an image generation prompt writer. Cover: the person's apparent features (hair colour/length/style, eye colour, build, skin tone, notable features), outfit in detail, pose, expression, camera framing, background, lighting and art style (photo / anime / 3D). Be factual and concise (120 words max). Output plain text.`;
