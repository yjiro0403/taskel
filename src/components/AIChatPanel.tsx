'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { useStore } from '@/store/useStore';
import { X, Send, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

export const AIChatPanel: React.FC = () => {
    const { isAIPanelOpen, toggleAIPanel, user, currentDate, sections } = useStore();
    const t = useTranslations('AIChatPanel'); // Adding translation hook placeholder
    // Fallback if translation is missing
    const t_placeholder = t('inputPlaceholder') === 'AIChatPanel.inputPlaceholder'
        ? 'AIにタスク作成や提案を依頼...'
        : t('inputPlaceholder');

    const [input, setInput] = useState('');
    const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');

    const { messages, sendMessage, status } = useChat({
        api: '/api/ai/chat',
        body: {
            userId: user?.uid,
            model: selectedModel,
            currentDate, // 表示中の日付を渡し、タスクが正しい日付で作成・表示されるようにする
            sections,   // 開始時刻から適切なセクションを割り当てるために必要
        },
        onError: (error) => {
            console.error('Chat error:', error);
            alert('AIチャットでエラーが発生しました。');
        },
        maxSteps: 5,
    });

    const isLoading = status === 'submitted' || status === 'streaming';

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInput(e.target.value);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;
        const value = input;
        setInput('');
        // ai SDK v6: 標準的なオブジェクト形式で送信
        await sendMessage(
            { role: 'user', content: value },
            {
                body: {
                    userId: user?.uid,
                    model: selectedModel,
                    currentDate,
                    sections,
                }
            }
        );
    };

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        if (isAIPanelOpen) {
            scrollToBottom();
        }
    }, [messages, isAIPanelOpen]);

    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isAIPanelOpen) {
                toggleAIPanel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isAIPanelOpen, toggleAIPanel]);

    return (
        <>
            <AnimatePresence>
                {isAIPanelOpen && (
                    <>
                        {/* Overlay for mobile/tablet */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 0.5 }}
                            exit={{ opacity: 0 }}
                            onClick={toggleAIPanel}
                            className="fixed inset-0 bg-black z-40 md:bg-transparent md:pointer-events-none"
                        />

                        <motion.div
                            initial={{ x: '100%', opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: '100%', opacity: 0 }}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            className="fixed right-0 bottom-0 top-0 w-full md:w-[400px] bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-xl z-[100] flex flex-col"
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                                        <Sparkles size={20} />
                                        <h2 className="font-semibold text-lg">AI Assistant</h2>
                                    </div>
                                    <select
                                        value={selectedModel}
                                        onChange={(e) => setSelectedModel(e.target.value)}
                                        className="text-[10px] bg-zinc-100 dark:bg-zinc-800 border-none rounded px-2 py-1 text-zinc-600 dark:text-zinc-400 focus:ring-1 focus:ring-indigo-500 outline-none w-fit"
                                    >
                                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                        <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                                        <option value="gemini-3-flash">Gemini 3 Flash</option>
                                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                                        <option value="gemini-3-pro">Gemini 3 Pro</option>
                                        <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                                        <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                                    </select>
                                </div>
                                <button
                                    onClick={toggleAIPanel}
                                    className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
                                >
                                    <X size={20} className="text-zinc-500" />
                                </button>
                            </div>

                            {/* Messages Area */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-50 dark:bg-zinc-950/50">
                                {messages.length === 0 && (
                                    <div className="flex flex-col items-center justify-center h-full text-zinc-400 text-sm gap-2">
                                        <Sparkles size={32} className="opacity-20" />
                                        <p>「明日15時に会議」のように話しかけてください</p>
                                    </div>
                                )}

                                {messages.map((m) => {
                                    // AI SDK v6: メッセージは parts 配列を使用。テキストとツール結果を parts から取得
                                    const parts = m.parts ?? [];
                                    const textParts = parts.filter((p: { type?: string }) => p.type === 'text');
                                    const textContent = textParts
                                        .map((p: { text?: string }) => p.text ?? '')
                                        .join('')
                                        .trim();
                                    const toolParts = parts.filter((p: { type?: string }) =>
                                        p.type === 'tool-createTask' || p.type === 'tool-getTodayTasks' || p.type === 'dynamic-tool'
                                    );

                                    return (
                                    <div
                                        key={m.id}
                                        className={cn(
                                            "flex w-full mb-4",
                                            m.role === 'user' ? "justify-end" : "justify-start"
                                        )}
                                    >
                                        <div
                                            className={cn(
                                                "max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-sm",
                                                m.role === 'user'
                                                    ? "bg-indigo-600 text-white rounded-br-none"
                                                    : "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-bl-none"
                                            )}
                                        >
                                            {/* テキストコンテンツ */}
                                            {textContent && (
                                                <div className="prose dark:prose-invert prose-sm max-w-none">
                                                    <ReactMarkdown
                                                        components={{
                                                            p: ({ node, ...props }) => <p className="mb-0" {...props} />
                                                        }}
                                                    >
                                                        {textContent}
                                                    </ReactMarkdown>
                                                </div>
                                            )}

                                            {/* Tool parts (AI SDK v6): tool-createTask, tool-getTodayTasks, dynamic-tool */}
                                            {toolParts.map((part: { type?: string; toolCallId?: string; state?: string; output?: { message?: string }; toolName?: string }, idx: number) => {
                                                const toolName = part.toolName ?? (part.type === 'tool-createTask' ? 'createTask' : part.type === 'tool-getTodayTasks' ? 'getTodayTasks' : '');
                                                const isCreateTask = toolName === 'createTask' || part.type === 'tool-createTask';
                                                const isGetTodayTasks = toolName === 'getTodayTasks' || part.type === 'tool-getTodayTasks';

                                                if (part.state === 'output-available' && part.output) {
                                                    const result = part.output as { message?: string };
                                                    const displayMsg = isCreateTask
                                                        ? (result?.message ?? 'タスクを作成しました')
                                                        : isGetTodayTasks
                                                            ? 'タスク情報を取得しました'
                                                            : typeof part.output === 'object' && part.output !== null && 'message' in part.output
                                                                ? (part.output as { message?: string }).message
                                                                : '完了しました';
                                                    return (
                                                        <div key={part.toolCallId ?? idx} className={cn(
                                                            "flex items-center gap-2",
                                                            textContent ? "mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-600" : "py-0.5"
                                                        )}>
                                                            <span className="text-base">{isCreateTask ? '✨' : '📊'}</span>
                                                            <span className={cn(
                                                                "text-zinc-700 dark:text-zinc-200",
                                                                !textContent && "font-medium"
                                                            )}>
                                                                {displayMsg}
                                                            </span>
                                                        </div>
                                                    );
                                                }
                                                if (part.state === 'output-error') {
                                                    return (
                                                        <div key={part.toolCallId ?? idx} className="flex items-center gap-2 mt-2 text-red-500 text-sm">
                                                            ⚠️ エラーが発生しました
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <div key={part.toolCallId ?? idx} className="flex items-center gap-2 mt-2 text-zinc-500">
                                                        <Loader2 size={14} className="animate-spin" />
                                                        <span>処理中...</span>
                                                    </div>
                                                );
                                            })}

                                            {/* フォールバック: toolInvocations (旧形式) */}
                                            {toolParts.length === 0 && (m as { toolInvocations?: Array<{ state?: string; result?: { message?: string }; toolName?: string; toolCallId?: string }> }).toolInvocations?.map((ti, idx) => {
                                                if (ti.state === 'result' && ti.result) {
                                                    const msg = (ti.result as { message?: string }).message ?? (ti.toolName === 'createTask' ? 'タスクを作成しました' : '完了しました');
                                                    return (
                                                        <div key={ti.toolCallId ?? idx} className="flex items-center gap-2 py-0.5">
                                                            <span className="text-base">✨</span>
                                                            <span className="text-zinc-700 dark:text-zinc-200 font-medium">{msg}</span>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })}
                                        </div>
                                    </div>
                                    );
                                })}

                                {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                                    <div className="flex justify-start">
                                        <div className="bg-white dark:bg-zinc-800 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm border border-zinc-200 dark:border-zinc-700">
                                            <Loader2 size={16} className="animate-spin text-indigo-500" />
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input Area */}
                            <form onSubmit={handleSubmit} className="p-4 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800">
                                <div className="relative flex items-center">
                                    <input
                                        className="w-full bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-full py-3 pl-4 pr-12 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 border-none transition-all"
                                        value={input}
                                        onChange={handleInputChange}
                                        placeholder={t_placeholder}
                                        disabled={isLoading}
                                    />
                                    <button
                                        type="submit"
                                        disabled={isLoading || !input.trim()}
                                        className="absolute right-2 p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                    </button>
                                </div>
                                <div className="text-center mt-2">
                                    <p className="text-[10px] text-zinc-400">
                                        AI can make mistakes. Please check important info.
                                    </p>
                                </div>
                            </form>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Floating Action Button */}
            <AnimatePresence>
                {!isAIPanelOpen && (
                    <motion.button
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={toggleAIPanel}
                        className="fixed bottom-24 right-6 p-4 bg-indigo-600 text-white rounded-full shadow-lg z-40 hover:bg-indigo-700 transition-colors"
                        aria-label="Open AI Assistant"
                    >
                        <Sparkles size={24} />
                    </motion.button>
                )}
            </AnimatePresence>
        </>
    );
};
