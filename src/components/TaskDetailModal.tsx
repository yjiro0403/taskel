'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Edit3, Calendar, Clock, Tag, Sparkles, MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { Task } from '@/types';
import { useStore } from '@/store/useStore';
import { AIStatusBadge } from '@/components/ai/AIStatusBadge';
import { TaskCommentThread } from '@/components/TaskCommentThread';

interface TaskDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task;
  onEdit: (task: Task) => void;
}

export default function TaskDetailModal({
  isOpen,
  onClose,
  task,
  onEdit,
}: TaskDetailModalProps) {
  const {
    taskComments,
    commentsLoading,
    aiProcessing,
    fetchComments,
    addUserComment,
    triggerAIReply,
    subscribeToComments,
    sections,
    projects,
  } = useStore();

  const comments = taskComments[task.id] || [];
  const isLoading = commentsLoading[task.id] || false;
  const isAIProcessing = aiProcessing[task.id] || false;
  const isAIWorkspace = task.aiTags?.includes('ai-workspace') ?? false;

  // コメントのリアルタイム購読
  useEffect(() => {
    if (!isOpen || !task.id) return;

    // 初回フェッチ
    fetchComments(task.id);

    // リアルタイム購読
    const unsubscribe = subscribeToComments(task.id);
    return () => unsubscribe();
  }, [isOpen, task.id, fetchComments, subscribeToComments]);

  if (!isOpen) return null;

  const sectionName = sections.find(s => s.id === task.sectionId)?.name || '';
  const projectName = projects.find(p => p.id === task.projectId)?.title;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3 min-w-0">
            {isAIWorkspace && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center">
                <Sparkles size={14} className="text-indigo-600" />
              </div>
            )}
            <h2 className="text-lg font-semibold text-gray-900 truncate">
              {task.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onEdit(task)}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Edit"
            >
              <Edit3 size={16} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* タスク情報 */}
        <div className="px-5 py-3 border-b border-gray-100 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
            {task.date && (
              <span className="flex items-center gap-1">
                <Calendar size={12} />
                {task.date}
              </span>
            )}
            {sectionName && (
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {sectionName}
              </span>
            )}
            {task.scheduledStart && (
              <span>{task.scheduledStart}~</span>
            )}
            <span>Est: {task.estimatedMinutes}min</span>
            {task.actualMinutes > 0 && (
              <span className="text-blue-600">Act: {task.actualMinutes.toFixed(1)}min</span>
            )}
            {projectName && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                {projectName}
              </span>
            )}
            {task.aiStatus && <AIStatusBadge status={task.aiStatus} size="md" />}
          </div>

          {/* メモ表示 */}
          {task.memo && (
            <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 max-h-32 overflow-y-auto">
              <p className="text-[10px] text-gray-400 mb-1 font-medium uppercase">Memo</p>
              <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 whitespace-pre-wrap">
                {task.memo}
              </div>
            </div>
          )}

          {/* タグ表示 */}
          {task.tags && task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {task.tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded-full border border-gray-200">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* コンバセーション */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-5 py-2 border-b border-gray-100 flex items-center gap-2">
            <MessageSquare size={14} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-600">
              {isAIWorkspace ? 'Taskel AI \u30B3\u30F3\u30D0\u30BB\u30FC\u30B7\u30E7\u30F3' : '\u30B3\u30E1\u30F3\u30C8'}
            </span>
            {comments.length > 0 && (
              <span className="text-[10px] text-gray-400">({comments.length})</span>
            )}
          </div>
          <div className="flex-1 min-h-[200px] max-h-[400px]">
            <TaskCommentThread
              taskId={task.id}
              comments={comments}
              isLoading={isLoading}
              isAIProcessing={isAIProcessing}
              isAIWorkspace={isAIWorkspace}
              onAddComment={(content) => addUserComment(task.id, content)}
              onTriggerAIReply={() => triggerAIReply(task.id)}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
