'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Edit3, Calendar, Clock, Tag, Sparkles, MessageSquare, FolderOpen, Timer, FileText, Paperclip } from 'lucide-react';
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
    tags: tagsList,
  } = useStore();

  const comments = taskComments[task.id] || [];
  const isLoading = commentsLoading[task.id] || false;
  const isAIProcessing = aiProcessing[task.id] || false;
  const isAIWorkspace = task.aiTags?.includes('ai-workspace') ?? false;

  // コメントのリアルタイム購読
  useEffect(() => {
    if (!isOpen || !task.id) return;

    fetchComments(task.id);
    const unsubscribe = subscribeToComments(task.id);
    return () => unsubscribe();
  }, [isOpen, task.id, fetchComments, subscribeToComments]);

  if (!isOpen) return null;

  const sectionName = sections.find(s => s.id === task.sectionId)?.name || '';
  const project = projects.find(p => p.id === task.projectId);
  const statusLabel = {
    open: '未着手',
    in_progress: '進行中',
    done: '完了',
    skipped: 'スキップ',
  }[task.status] || task.status;

  const statusColor = {
    open: 'bg-gray-100 text-gray-700',
    in_progress: 'bg-blue-100 text-blue-700',
    done: 'bg-green-100 text-green-700',
    skipped: 'bg-yellow-100 text-yellow-700',
  }[task.status] || 'bg-gray-100 text-gray-700';

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
              title="編集"
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

        {/* タスク情報（GitHub Issue風） */}
        <div className="px-5 py-4 border-b border-gray-100 space-y-3 overflow-y-auto max-h-[40vh]">
          {/* ステータス + AI ステータス */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('px-2.5 py-1 text-xs font-medium rounded-full', statusColor)}>
              {statusLabel}
            </span>
            {task.aiStatus && <AIStatusBadge status={task.aiStatus} size="md" />}
          </div>

          {/* 情報グリッド */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {/* 日付 */}
            {task.date && (
              <div className="flex items-center gap-2 text-gray-600">
                <Calendar size={14} className="text-gray-400 flex-shrink-0" />
                <span>{task.date}</span>
              </div>
            )}

            {/* セクション */}
            {sectionName && (
              <div className="flex items-center gap-2 text-gray-600">
                <Clock size={14} className="text-gray-400 flex-shrink-0" />
                <span>{sectionName}{task.scheduledStart ? ` (${task.scheduledStart}~)` : ''}</span>
              </div>
            )}

            {/* 見積もり / 実績 */}
            <div className="flex items-center gap-2 text-gray-600">
              <Timer size={14} className="text-gray-400 flex-shrink-0" />
              <span>
                見積: {task.estimatedMinutes}分
                {task.actualMinutes > 0 && (
                  <span className="ml-2 text-blue-600">実績: {Math.round(task.actualMinutes)}分</span>
                )}
              </span>
            </div>

            {/* プロジェクト */}
            {project && (
              <div className="flex items-center gap-2 text-gray-600">
                <FolderOpen size={14} className="text-gray-400 flex-shrink-0" />
                <span>{project.title}</span>
              </div>
            )}

            {/* スコア */}
            {task.score !== undefined && task.score !== null && (
              <div className="flex items-center gap-2 text-gray-600">
                <span className="text-gray-400 text-xs font-medium w-3.5 text-center">S</span>
                <span>Score: {task.score}</span>
              </div>
            )}
          </div>

          {/* タグ */}
          {task.tags && task.tags.length > 0 && (
            <div className="flex items-start gap-2">
              <Tag size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex flex-wrap gap-1.5">
                {task.tags.map(tag => (
                  <span key={tag} className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded-full border border-blue-200">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* メモ */}
          {task.memo && (
            <div className="flex items-start gap-2">
              <FileText size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 flex-1 max-h-32 overflow-y-auto whitespace-pre-wrap">
                {task.memo}
              </div>
            </div>
          )}

          {/* 添付ファイル */}
          {task.attachments && task.attachments.length > 0 && (
            <div className="flex items-start gap-2">
              <Paperclip size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex flex-wrap gap-2">
                {task.attachments.map(att => (
                  <a
                    key={att.id}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200 hover:border-blue-300 transition-colors"
                  >
                    <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* コンバセーション */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-5 py-2 border-b border-gray-100 flex items-center gap-2">
            <MessageSquare size={14} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-600">
              {isAIWorkspace ? 'Taskel AI コンバセーション' : 'コメント'}
            </span>
            {comments.length > 0 && (
              <span className="text-[10px] text-gray-400">({comments.length})</span>
            )}
          </div>
          <div className="flex-1 min-h-[200px] max-h-[300px]">
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
