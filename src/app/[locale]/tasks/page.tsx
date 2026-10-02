'use client';

import { Suspense, useEffect, useMemo } from 'react';
import TaskList from '@/components/TaskList';
import AddTaskModal from '@/components/LazyAddTaskModal';
import RightSidebar from '@/components/RightSidebar';
import LeftSidebar from '@/components/LeftSidebar'; // NEW
import DailyNoteModal from '@/components/DailyNoteModal'; // NEW
import SelectionHeader from '@/components/SelectionHeader'; // NEW
import TasksDnDWrapper from '@/components/TasksDnDWrapper'; // NEW
import TaskDeepLinkHandler from '@/components/TaskDeepLinkHandler';
import NowNextWidget from '@/components/NowNextWidget';
import { Plus, Clock, PanelRight, Menu, Search } from 'lucide-react'; // Added Menu
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/useStore';
import { calculateTaskSchedule, formatTime } from '@/lib/timeUtils';
import { sortTasksForDisplay } from '@/lib/tasks/taskOrder';
import Image from 'next/image';
import { useTranslations } from 'next-intl';

export default function Home() {
  const t = useTranslations('TaskList');
  const tSearch = useTranslations('Search');
  const { tasks, routines, sections, currentDate, getMergedTasks, currentTime, setCurrentTime, isRightSidebarOpen, toggleRightSidebar, toggleLeftSidebar, isAddTaskModalOpen, openAddTaskModal, closeAddTaskModal, openSearchModal, timelineEnabled } = useStore(useShallow((state) => ({
    tasks: state.tasks,
    routines: state.routines,
    sections: state.sections,
    currentDate: state.currentDate,
    getMergedTasks: state.getMergedTasks,
    currentTime: state.currentTime,
    setCurrentTime: state.setCurrentTime,
    isRightSidebarOpen: state.isRightSidebarOpen,
    toggleRightSidebar: state.toggleRightSidebar,
    toggleLeftSidebar: state.toggleLeftSidebar,
    isAddTaskModalOpen: state.isAddTaskModalOpen,
    openAddTaskModal: state.openAddTaskModal,
    closeAddTaskModal: state.closeAddTaskModal,
    openSearchModal: state.openSearchModal,
    timelineEnabled: state.timelineEnabled,
  })));

  useEffect(() => {
    // Initial time set
    setCurrentTime(new Date());
  }, [setCurrentTime]);

  // 「終了予定」: 表示中の日のタスク（ルーチンの仮想タスク含む）を TaskList と同じ順序で
  // 並べたときの最後の終了時刻。以前は全日付のタスクを毎分フィルタ・ソートし直し、
  // 結果を state に書き戻して 2 回描画していたため、派生値として useMemo で求める。
  // tasks / routines は getMergedTasks の入力なので依存に含める。
  const finishTime = useMemo(() => {
    const dayTasks = getMergedTasks(currentDate);
    if (dayTasks.length === 0) return null;
    const schedule = calculateTaskSchedule(sortTasksForDisplay(dayTasks, sections), currentTime);
    let latest: Date | null = null;
    schedule.forEach((slot) => {
      if (!latest || slot.end > latest) latest = slot.end;
    });
    return latest;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tasks / routines feed getMergedTasks
  }, [getMergedTasks, currentDate, tasks, routines, sections, currentTime]);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm transition-all">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Left Sidebar Toggle */}
            <button
              onClick={toggleLeftSidebar}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('menu')}
            >
              <Menu size={24} />
            </button>


            <div className="relative h-8 w-32">
              <Image
                src="/logo.png"
                alt="Taskel"
                fill
                className="object-contain object-left"
                priority
                sizes="(max-width: 768px) 100vw, 33vw"
              />
            </div>
          </div>

          <div className="flex items-center gap-6 text-sm">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-gray-500 text-xs">{t('current')}</span>
              {/* Avoid hydration mismatch by rendering time only on client or using suppressed content */}
              <span className="font-mono text-gray-900 font-medium" suppressHydrationWarning>
                {formatTime(currentTime)}
              </span>
            </div>

            {finishTime && (
              <div className="flex flex-col items-end">
                <span className="text-gray-500 text-xs">{t('finish_at')}</span>
                <div className="flex items-center gap-1 text-blue-600 font-bold font-mono text-lg leading-none" suppressHydrationWarning>
                  <Clock size={14} />
                  {formatTime(finishTime)}
                </div>
              </div>
            )}

            <button
              onClick={openSearchModal}
              className="p-2 rounded-lg transition-colors text-gray-500 hover:bg-gray-100 hover:text-blue-600"
              title={tSearch('open_button')}
              aria-label={tSearch('open_button')}
            >
              <Search size={20} />
            </button>

            <button
              onClick={toggleRightSidebar}
              className={`p-2 rounded-lg transition-colors ${isRightSidebarOpen ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
              title={t('toggle_unscheduled')}
            >
              <PanelRight size={20} />
            </button>
          </div>
        </div>
      </header>

      <TasksDnDWrapper>
        <div className="flex relative">
          <SelectionHeader />
          <main className="flex-1 py-8 min-w-0 transition-all duration-300">
            <div className={`mx-auto px-4 ${timelineEnabled ? 'max-w-5xl' : 'max-w-3xl'}`}>
              {/* 今 / 次 ウィジェット: 実行中タスクの残り時間と次の予定までのカウントダウン。
                  sticky でリストをスクロールしても見え続ける（閲覧中の日付に関わらず「今日」を表示） */}
              <div className="px-4">
                <NowNextWidget />
              </div>
              {/* DailyNotePanel removed, using Modal instead */}
              <TaskList />
            </div>
          </main>
          <RightSidebar />
        </div>
      </TasksDnDWrapper>

      <LeftSidebar />
      <DailyNoteModal />
      {/* useSearchParams requires a Suspense boundary in the App Router */}
      <Suspense fallback={null}>
        <TaskDeepLinkHandler />
      </Suspense>

      <button
        id="tour-add-task-btn"
        onClick={openAddTaskModal}
        className="fixed bottom-8 right-8 bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all duration-200 z-50"
        aria-label={t('add_task')}
      >
        <Plus size={24} />
      </button>

      <AddTaskModal
        isOpen={isAddTaskModalOpen}
        onClose={closeAddTaskModal}
      />
    </div>
  );
}
