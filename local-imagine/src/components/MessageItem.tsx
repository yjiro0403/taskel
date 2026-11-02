"use client";

import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import { Message } from "@/lib/types";
import { fileUrl } from "@/lib/api";
import { GenerationGrid } from "./GenerationGrid";

export function MessageItem({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={clsx("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={clsx("max-w-[85%] min-w-0", isUser ? "items-end" : "w-full")}>
        {(message.content || message.error) && (
          <div
            className={clsx(
              "whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              isUser ? "bg-accent text-white" : "bg-panel border border-border",
              message.error && "border-danger/60",
            )}
          >
            {message.content}
            {message.error && (
              <div className="flex items-start gap-2 text-danger">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>{message.error}</span>
              </div>
            )}
          </div>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {message.attachments.map((a) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={a} src={fileUrl(a)} alt="添付" className="h-24 w-24 rounded-lg object-cover" />
            ))}
          </div>
        )}
        {message.generations?.map((g) => <GenerationGrid key={g.id} messageId={message.id} batch={g} />)}
        {!isUser && message.model && <div className="mt-1 text-[10px] text-muted">{message.model}</div>}
      </div>
    </div>
  );
}
