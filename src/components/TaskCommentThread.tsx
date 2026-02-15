'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Sparkles, Send, Loader2, User } from 'lucide-react';
import clsx from 'clsx';
import { TaskComment } from '@/types';

interface TaskCommentThreadProps {
  taskId: string;
  comments: TaskComment[];
  isLoading: boolean;
  isAIProcessing: boolean;
  isAIWorkspace: boolean;
  onAddComment: (content: string) => void;
  onTriggerAIReply: () => void;
}

export function TaskCommentThread({
  taskId,
  comments,
  isLoading,
  isAIProcessing,
  isAIWorkspace,
  onAddComment,
  onTriggerAIReply,
}: TaskCommentThreadProps) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新しいコメントが来たらスクロール
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments.length]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setInput('');

    try {
      onAddComment(trimmed);

      // ai-workspaceの場合、コメント送信後にAIリプライをトリガー
      if (isAIWorkspace) {
        // 少し待ってからAIリプライを開始（コメントがDBに反映されるのを待つ）
        setTimeout(() => {
          onTriggerAIReply();
        }, 500);
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400">
        <Loader2 size={20} className="animate-spin mr-2" />
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* コメント一覧 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 p-4">
        {comments.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">
            {isAIWorkspace
              ? 'Taskel AI\u3068\u306E\u4F1A\u8A71\u3092\u59CB\u3081\u307E\u3057\u3087\u3046'
              : '\u30B3\u30E1\u30F3\u30C8\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093'}
          </div>
        )}

        {comments.map((comment) => (
          <div
            key={comment.id}
            className={clsx(
              'rounded-lg p-3',
              comment.authorType === 'ai'
                ? 'bg-indigo-50 border border-indigo-100'
                : 'bg-gray-50 border border-gray-100'
            )}
          >
            {/* ヘッダー */}
            <div className="flex items-center gap-2 mb-2">
              {comment.authorType === 'ai' ? (
                <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center">
                  <Sparkles size={12} className="text-indigo-600" />
                </div>
              ) : (
                <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center">
                  <User size={12} className="text-gray-500" />
                </div>
              )}
              <span className={clsx(
                'text-xs font-medium',
                comment.authorType === 'ai' ? 'text-indigo-700' : 'text-gray-700'
              )}>
                {comment.authorType === 'ai' ? 'Taskel AI' : (comment.authorName || 'You')}
              </span>
              <span className="text-[10px] text-gray-400">
                {new Date(comment.createdAt).toLocaleString('ja-JP', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>

            {/* コメント本文 */}
            <div className="prose prose-sm max-w-none text-gray-800 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <ReactMarkdown>{comment.content}</ReactMarkdown>
            </div>
          </div>
        ))}

        {/* AI処理中インジケーター */}
        {isAIProcessing && (
          <div className="rounded-lg p-3 bg-indigo-50 border border-indigo-100 animate-pulse">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center">
                <Sparkles size={12} className="text-indigo-600" />
              </div>
              <span className="text-xs font-medium text-indigo-700">Taskel AI</span>
              <Loader2 size={12} className="animate-spin text-indigo-500" />
              <span className="text-xs text-indigo-500">\u8003\u3048\u4E2D...</span>
            </div>
          </div>
        )}
      </div>

      {/* 入力エリア */}
      <div className="border-t border-gray-200 p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isAIWorkspace ? 'Taskel AI\u306B\u6307\u793A\u3092\u51FA\u3059...' : '\u30B3\u30E1\u30F3\u30C8\u3092\u5165\u529B...'}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg resize-none text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            rows={2}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isSending || isAIProcessing}
            className={clsx(
              'px-3 py-2 rounded-lg transition-colors self-end',
              input.trim() && !isSending && !isAIProcessing
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
          >
            {isSending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">Ctrl+Enter \u3067\u9001\u4FE1</p>
      </div>
    </div>
  );
}
