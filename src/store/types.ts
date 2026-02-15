// Store全体の型定義
// 各スライスのインターフェースをここで統合

import { Task, Section, Routine, Tag, DailyNote, Project, HubRole, WeeklyNote, MonthlyNote, YearlyNote } from '@/types';
import type { User } from 'firebase/auth';
import type { AISlice } from './slices/aiSlice';
import type { GoalSlice } from './slices/goalSlice';

// --- 各スライスの型定義 ---

export interface TaskSlice {
    tasks: Task[];
    selectedTaskIds: string[];
    currentDate: string;
    setCurrentDate: (date: string) => void;
    addTask: (task: Task) => void;
    updateTask: (taskId: string, updates: Partial<Task>) => void;
    duplicateTask: (taskId: string) => Promise<void>;
    deleteTask: (taskId: string) => void;
    bulkUpdateTasks: (taskIds: string[], updates: Partial<Task>) => void;
    bulkDeleteTasks: (taskIds: string[]) => Promise<void>;
    bulkAddTasks: (tasks: Task[]) => Promise<void>;
    toggleTaskSelection: (taskId: string) => void;
    clearSelection: () => void;
    reorderTasks: (taskIds: string[]) => Promise<void>;
    getMergedTasks: (date: string) => Task[];
    migrateTasks: () => Promise<{ success: boolean; message: string; count: number }>;
}

export interface SectionSlice {
    sections: Section[];
    addSection: (section: Section) => Promise<void>;
    updateSection: (sectionId: string, updates: Partial<Section>) => Promise<void>;
    deleteSection: (sectionId: string) => Promise<void>;
    rebuildSections: () => Promise<void>;
}

export interface ProjectSlice {
    projects: Project[];
    addProject: (project: Omit<Project, 'ownerId' | 'memberIds' | 'roles'>) => Promise<void>;
    updateProject: (projectId: string, updates: Partial<Project>) => Promise<void>;
    deleteProject: (projectId: string) => Promise<void>;
    inviteMember: (projectId: string, email: string) => Promise<{ success: boolean; message: string }>;
    generateInviteLink: (projectId: string, email?: string, role?: HubRole) => Promise<{ success: boolean; joinLink?: string; message: string }>;
    joinProjectWithToken: (token: string) => Promise<{ success: boolean; projectId?: string; message: string }>;
}

export interface RoutineSlice {
    routines: Routine[];
    addRoutine: (routine: Routine) => void;
    updateRoutine: (routineId: string, updates: Partial<Routine>) => void;
    deleteRoutine: (routineId: string) => void;
}

export interface TagSlice {
    tags: Tag[];
    addTag: (tag: Tag) => Promise<string>;
    updateTag: (tagId: string, updates: Partial<Tag>) => void;
    deleteTag: (tagId: string) => void;
    getUniqueTags: () => string[];
}

export interface NoteSlice {
    dailyNotes: DailyNote[];
    weeklyNotes: WeeklyNote[];
    monthlyNotes: MonthlyNote[];
    yearlyNotes: YearlyNote[];
    saveDailyNote: (date: string, content: string) => Promise<void>;
    saveWeeklyNote: (weekId: string, content: string) => Promise<void>;
    saveMonthlyNote: (monthId: string, content: string) => Promise<void>;
    saveYearlyNote: (yearId: string, content: string) => Promise<void>;
}

export interface AuthSlice {
    user: User | null;
    unsubscribe: (() => void) | null;
    setUser: (user: User | null) => void;
}

export interface UISlice {
    currentTime: Date;
    setCurrentTime: (time: Date) => void;
    isRightSidebarOpen: boolean;
    toggleRightSidebar: () => void;
    isLeftSidebarOpen: boolean;
    toggleLeftSidebar: () => void;
    isDailyNoteModalOpen: boolean;
    toggleDailyNoteModal: () => void;
    isAddTaskModalOpen: boolean;
    openAddTaskModal: () => void;
    closeAddTaskModal: () => void;
}

export interface CalendarSlice {
    syncGoogleCalendar: (accessToken: string, targetDateStr?: string) => Promise<void>;
}

// 全スライスを統合した型
export type StoreState =
    TaskSlice &
    SectionSlice &
    ProjectSlice &
    RoutineSlice &
    TagSlice &
    NoteSlice &
    AuthSlice &
    UISlice &
    CalendarSlice &
    AISlice &
    GoalSlice;
