import { StreamEvent } from "@/lib/types";

/**
 * Server-Sent Events helper for route handlers.
 * Usage:
 *   const { stream, send, close } = createSse();
 *   void run(send).finally(close);
 *   return sseResponse(stream);
 */
export function createSse() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      // Comment lines keep proxies/browsers from timing out during long generations.
      heartbeat = setInterval(() => {
        if (!closed) {
          try {
            c.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            /* closed */
          }
        }
      }, 15000);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  const send = (event: StreamEvent) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      closed = true;
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    try {
      controller?.close();
    } catch {
      /* ignore */
    }
  };

  return { stream, send, close, isClosed: () => closed };
}

export function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
