'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { useStore } from '@/store/useStore';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { ChatMessage } from './ai/ChatMessage';
import { ChatInput } from './ai/ChatInput';
import { ModelSelector } from './ai/ModelSelector';
import { TaskCandidate } from '@/lib/ai/types';

export const AIChatPanel: React.FC = () => {
    const {
        isAIPanelOpen,
        toggleAIPanel,
        user,
        currentDate,
        sections,
        taskCandidates,
        addTaskCandidate,
        confirmTaskCandidate,
        dismissTaskCandidate,
        updateTaskCandidate,
        // Phase 2追加
        cachedGoalSummaries,
        setCachedGoalSummaries,
        cachedCalibrationHint,
        setCachedCalibrationHint,
        confirmMultipleCandidates,
        dismissMultipleCandidates,
        // A1追加
        confirmAndStartTask,
        // Goals情報取得用
        goals,
        tasks,
    } = useStore();
    const t = useTranslations('AIChatPanel');
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
            // Phase 2追加
            activeGoals: cachedGoalSummaries,
            calibrationHint: cachedCalibrationHint,
        },
        onError: (error: Error) => {
            console.error('Chat error:', error);
            alert('AIチャットでエラーが発生しました。');
        },
        maxSteps: 5,
    } as any);

    const isLoading = status === 'submitted' || status === 'streaming';

    // TaskCandidateの検出と自動追加（Phase 2: Calibrationデータも検出）
    useEffect(() => {
        // 最新のassistantメッセージからtask_suggestionとcalibration_feedbackを検出
        const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
        if (!lastAssistant?.parts) return;

        for (const part of lastAssistant.parts) {
            const partAny = part as any;
            if (partAny.type?.startsWith('tool-') && partAny.state === 'output-available') {
                const output = partAny.output as any;

                // 既存: task_suggestion検出
                if (output?.type === 'task_suggestion' && output?.candidate) {
                    const candidate = output.candidate as TaskCandidate;
                    // BUG-001修正: tempIdで重複チェック
                    const alreadyExists = taskCandidates.some(c => c.tempId === candidate.tempId);
                    if (!alreadyExists) {
                        addTaskCandidate(candidate);
                    }
                }

                // Phase 2追加: calibration_feedback検出 → キャッシュ更新
                if (output?.type === 'calibration_feedback' && output?.overall) {
                    setCachedCalibrationHint({
                        accuracyRatio: output.overall.accuracyRatio,
                        averageDeviationPercent: output.overall.averageDeviationPercent,
                        sampleSize: output.overall.totalTasks,
                    });
                }

                // Phase 2追加: goals_summary検出 → キャッシュ更新
                if (output?.type === 'goals_summary' && output?.goals) {
                    setCachedGoalSummaries(output.goals);
                }
            }
        }
    }, [messages, taskCandidates, addTaskCandidate, setCachedCalibrationHint, setCachedGoalSummaries]);

    const handleSubmit = async () => {
        if (!input.trim()) return;
        const value = input;
        setInput('');
        // ai SDK v6: text形式で送信
        await sendMessage(
            { text: value },
            {
                body: {
                    userId: user?.uid,
                    model: selectedModel,
                    currentDate,
                    sections,
                    activeGoals: cachedGoalSummaries,
                    calibrationHint: cachedCalibrationHint,
                }
            } as any
        );
    };

    const handleTaskConfirm = (candidate: TaskCandidate) => {
        confirmTaskCandidate(candidate.tempId);
    };

    const handleTaskConfirmAndStart = (candidate: TaskCandidate) => {
        confirmAndStartTask(candidate.tempId);
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

    // Phase 2追加: AIパネルオープン時にGoalsキャッシュを更新
    useEffect(() => {
        if (isAIPanelOpen && goals.length > 0) {
            // GoalSliceのgoals配列からGoalSummary[]に変換
            const goalSummaries = goals
                .filter(g => g.status === 'pending' || g.status === 'in_progress')
                .map(g => {
                    // 紐づいているタスク数をカウント
                    const linkedTaskCount = tasks.filter(t => t.parentGoalId === g.id).length;

                    return {
                        id: g.id,
                        title: g.title,
                        type: g.type,
                        status: g.status,
                        progress: g.progress || 0,
                        assignedYear: g.assignedYear,
                        assignedMonth: g.assignedMonth,
                        assignedWeek: g.assignedWeek,
                        parentGoalId: g.parentGoalId,
                        linkedTaskCount,
                        aiSuggestedBreakdown: g.aiAnalysis?.suggestedBreakdown,
                        keyResults: g.aiAnalysis?.keyResults,
                    };
                });
            setCachedGoalSummaries(goalSummaries);
        }
    }, [isAIPanelOpen, goals, tasks, setCachedGoalSummaries]);

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
                            className="fixed right-0 bottom-0 top-0 w-full md:w-[400px] bg-white border-l border-zinc-200 shadow-xl z-[100] flex flex-col"
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between p-4 border-b border-zinc-200">
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2 text-indigo-600">
                                        <Sparkles size={20} />
                                        <h2 className="font-semibold text-lg">AI Assistant</h2>
                                    </div>
                                    <ModelSelector value={selectedModel} onChange={setSelectedModel} />
                                </div>
                                <button
                                    onClick={toggleAIPanel}
                                    className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
                                >
                                    <X size={20} className="text-zinc-500" />
                                </button>
                            </div>

                            {/* Messages Area */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-50">
                                {messages.length === 0 && (
                                    <div className="flex flex-col items-center justify-center h-full text-zinc-400 text-sm gap-2">
                                        <Sparkles size={32} className="opacity-20" />
                                        <p>「明日15時に会議」のように話しかけてください</p>
                                    </div>
                                )}

                                {messages.map((m) => (
                                    <ChatMessage
                                        key={m.id}
                                        message={m}
                                        onTaskConfirm={handleTaskConfirm}
                                        onTaskDismiss={dismissTaskCandidate}
                                        onTaskEdit={updateTaskCandidate}
                                        availableGoals={cachedGoalSummaries}
                                        onConfirmMultiple={confirmMultipleCandidates}
                                        onDismissMultiple={dismissMultipleCandidates}
                                        onTaskConfirmAndStart={handleTaskConfirmAndStart}
                                    />
                                ))}

                                {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                                    <div className="flex justify-start">
                                        <div className="bg-white rounded-2xl rounded-bl-none px-4 py-3 shadow-sm border border-zinc-200">
                                            <Loader2 size={16} className="animate-spin text-indigo-500" />
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input Area */}
                            <ChatInput
                                value={input}
                                onChange={setInput}
                                onSubmit={handleSubmit}
                                isLoading={isLoading}
                                placeholder={t_placeholder}
                            />
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
                        className="fixed bottom-24 right-6 md:bottom-24 md:right-8 p-4 bg-indigo-600 text-white rounded-full shadow-lg z-40 hover:bg-indigo-700 transition-colors"
                        aria-label="Open AI Assistant"
                    >
                        <Sparkles size={24} />
                    </motion.button>
                )}
            </AnimatePresence>
        </>
    );
};
