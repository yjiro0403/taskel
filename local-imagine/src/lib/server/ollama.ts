import { LlmModelInfo } from "@/lib/types";

/**
 * Minimal Ollama REST client (https://github.com/ollama/ollama/blob/main/docs/api.md).
 * Only the endpoints the app needs; no SDK dependency so the behaviour is transparent.
 */

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** base64-encoded images for multimodal models */
  images?: string[];
}

export interface OllamaChatOptions {
  model: string;
  messages: OllamaMessage[];
  /** "json" or a JSON schema object for structured outputs */
  format?: "json" | Record<string, unknown>;
  options?: { temperature?: number; num_ctx?: number; top_p?: number; seed?: number; num_predict?: number };
  /** Reasoning models: disable thinking to keep latency low */
  think?: boolean;
  keep_alive?: string | number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string; thinking?: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
}

export class OllamaError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "OllamaError";
  }
}

function joinUrl(base: string, p: string): string {
  return base.replace(/\/+$/, "") + p;
}

async function request<T>(base: string, p: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), init.timeoutMs ?? 15000);
  const external = init.signal;
  const onAbort = () => controller.abort(external?.reason);
  external?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(joinUrl(base, p), { ...init, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new OllamaError(`Ollama ${p} failed: ${res.status} ${text.slice(0, 300)}`, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof OllamaError) throw err;
    if (external?.aborted) throw new OllamaError("Cancelled");
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout/i.test(msg)) throw new OllamaError(`Ollama did not answer within ${Math.round((init.timeoutMs ?? 15000) / 1000)}s (${base}). The model may still be loading.`);
    throw new OllamaError(`Ollama unreachable at ${base} (${msg}). Is \`ollama serve\` running?`);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onAbort);
  }
}

export async function ollamaVersion(base: string): Promise<string> {
  const r = await request<{ version: string }>(base, "/api/version", { timeoutMs: 3000 });
  return r.version;
}

export async function listOllamaModels(base: string): Promise<LlmModelInfo[]> {
  const r = await request<{
    models: Array<{
      name: string;
      size: number;
      modified_at?: string;
      details?: { family?: string; parameter_size?: string; quantization_level?: string };
    }>;
  }>(base, "/api/tags", { timeoutMs: 5000 });
  return (r.models ?? [])
    .map((m) => ({
      name: m.name,
      size: m.size,
      family: m.details?.family,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
      modifiedAt: m.modified_at,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Non-streaming chat; used with `format` for structured planning. */
export async function ollamaChat(base: string, opts: OllamaChatOptions): Promise<OllamaChatResponse> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: false,
    options: opts.options,
    keep_alive: typeof opts.keep_alive === "string" ? opts.keep_alive.trim() || "5m" : (opts.keep_alive ?? "5m"),
  };
  if (opts.format) body.format = opts.format;
  if (opts.think !== undefined) body.think = opts.think;
  return request<OllamaChatResponse>(base, "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
    // Local models on an M1 can take a while on the first (cold) call.
    timeoutMs: opts.timeoutMs ?? 10 * 60 * 1000,
  });
}

/**
 * Some models reject the `think` parameter; retry without it.
 * Structured output occasionally comes back wrapped in markdown fences; strip them.
 */
export async function ollamaChatJson<T>(base: string, opts: OllamaChatOptions): Promise<{ data: T; raw: OllamaChatResponse }> {
  let raw: OllamaChatResponse;
  try {
    raw = await ollamaChat(base, opts);
  } catch (err) {
    if (opts.think !== undefined && err instanceof OllamaError && err.status === 400) {
      raw = await ollamaChat(base, { ...opts, think: undefined });
    } else {
      throw err;
    }
  }
  const text = raw.message?.content ?? "";
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try {
    return { data: JSON.parse(cleaned) as T, raw };
  } catch {
    // Try to salvage the first {...} block
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return { data: JSON.parse(m[0]) as T, raw };
      } catch {
        /* fall through */
      }
    }
    throw new OllamaError(`Model "${opts.model}" did not return valid JSON: ${text.slice(0, 200)}`);
  }
}
