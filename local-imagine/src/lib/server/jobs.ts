/**
 * In-memory registry of running generation turns so they can be cancelled server-side
 * (the client calls POST /api/chats/[id]/cancel) and so stale "running" batches left behind
 * by a crash can be recognised and marked as errors when a chat is loaded.
 */
import { Chat } from "@/lib/types";

const turns = new Map<string, AbortController>();
const activeBatches = new Set<string>();

/** Create a controller for a turn; aborting the request signal also aborts it. */
export function beginTurn(chatId: string, requestSignal?: AbortSignal): AbortController {
  cancelTurn(chatId);
  const controller = new AbortController();
  turns.set(chatId, controller);
  requestSignal?.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

export function endTurn(chatId: string, controller: AbortController): void {
  if (turns.get(chatId) === controller) turns.delete(chatId);
}

export function cancelTurn(chatId: string): boolean {
  const c = turns.get(chatId);
  if (!c) return false;
  c.abort();
  turns.delete(chatId);
  return true;
}

export function isTurnRunning(chatId: string): boolean {
  return turns.has(chatId);
}

export function markBatchActive(batchId: string, active: boolean): void {
  if (active) activeBatches.add(batchId);
  else activeBatches.delete(batchId);
}

/**
 * Batches persisted as queued/running that no live job owns were interrupted
 * (server restart, crash). Flip them to error so the UI stops showing spinners.
 * Returns true when something changed.
 */
export function reconcileStaleBatches(chat: Chat): boolean {
  let changed = false;
  for (const m of chat.messages) {
    for (const g of m.generations ?? []) {
      if ((g.status === "queued" || g.status === "running") && !activeBatches.has(g.id) && !isTurnRunning(chat.id)) {
        g.status = "error";
        g.error = "中断されました (サーバーの再起動など)";
        changed = true;
      }
    }
  }
  return changed;
}
