'use client';

import { useState, useEffect } from 'react';
import TaskList from '@/components/TaskList';
import AddTaskModal from '@/components/AddTaskModal';
import RightSidebar from '@/components/RightSidebar';
import LeftSidebar from '@/components/LeftSidebar'; // NEW
import DailyNoteModal from '@/components/DailyNoteModal'; // NEW
import SelectionHeader from '@/components/SelectionHeader'; // NEW
import TasksDnDWrapper from '@/components/TasksDnDWrapper'; // NEW
import { Plus, Clock, PanelRight, Menu } from 'lucide-react'; // Added Menu
import { useStore } from '@/store/useStore';
import { calculateTaskSchedule, formatTime } from '@/lib/timeUtils';
import Image from 'next/image';

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { tasks, sections, currentTime, setCurrentTime, isRightSidebarOpen, toggleRightSidebar, toggleLeftSidebar } = useStore();
  const [finishTime, setFinishTime] = useState<Date | null>(null);

  useEffect(() => {
    // Initial time set
    setCurrentTime(new Date());
  }, [setCurrentTime]);

  useEffect(() => {
    // Calculate total finish time
    if (tasks.length === 0) {
      setFinishTime(null);
      return;
    }

    // Sort all tasks
    const sortedSections = [...sections].sort((a, b) => a.order - b.order);
    let allTasks: any[] = [];
    sortedSections.forEach(section => {
      const sectionTasks = tasks
        .filter(t => t.sectionId === section.id)
        .sort((a, b) => a.order - b.order);
      allTasks = [...allTasks, ...sectionTasks];
    });

    const schedule = calculateTaskSchedule(allTasks, currentTime);

    // Find the very last task's end time
    if (schedule.size > 0) {
      const lastTask = allTasks.reverse().find(t => schedule.has(t.id));
      if (lastTask) {
        const slot = schedule.get(lastTask.id);
        setFinishTime(slot ? slot.end : null);
      }
    }
  }, [tasks, sections, currentTime]);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm transition-all">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Left Sidebar Toggle */}
            <button
              onClick={toggleLeftSidebar}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              title="Menu"
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
              <span className="text-gray-500 text-xs">Current</span>
              {/* Avoid hydration mismatch by rendering time only on client or using suppressed content */}
              <span className="font-mono text-gray-900 font-medium" suppressHydrationWarning>
                {formatTime(currentTime)}
              </span>
            </div>

            {finishTime && (
              <div className="flex flex-col items-end">
                <span className="text-gray-500 text-xs">Finish at</span>
                <div className="flex items-center gap-1 text-blue-600 font-bold font-mono text-lg leading-none" suppressHydrationWarning>
                  <Clock size={14} />
                  {formatTime(finishTime)}
                </div>
              </div>
            )}

            <button
              onClick={toggleRightSidebar}
              className={`p-2 rounded-lg transition-colors ${isRightSidebarOpen ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
              title="Toggle Unscheduled Tasks"
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
            <div className="max-w-3xl mx-auto px-4">
              {/* DailyNotePanel removed, using Modal instead */}
              <TaskList />
            </div>
          </main>
          <RightSidebar />
        </div>
      </TasksDnDWrapper>

      <LeftSidebar />
      <DailyNoteModal />

      <button
        id="tour-add-task-btn"
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-8 right-8 bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all duration-200 z-50"
        aria-label="Add Task"
      >
        <Plus size={24} />
      </button>

      <AddTaskModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
