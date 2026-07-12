// Store全体の型定義
// 各スライスのインターフェースをここで統合

import { Task, Section, Routine, Tag, DailyNote, Project, HubRole, ItemTemplate, WeeklyNote, MonthlyNote, YearlyNote } from '@/types';
import type { AppUser } from '@/types/auth';
import type { AISlice } from './slices/aiSlice';
import type { GoalSlice } from './slices/goalSlice';
import type { BillingSlice } from './slices/billingSlice';
import type { WorkspaceSlice } from './slices/workspaceSlice';

// --- 各スライスの型定義 ---

export interface TaskSlice {
    tasks: Task[];
    // tasks の初回ロードが完了したか。初期ロードは「軽いデータ(sections/routines/...)を先に描画し、
    // tasks は後追い」の2フェーズ構成のため、routines だけが載って tasks が [] の窓が存在する。
    // その窓で getMergedTasks が仮想ルーチンタスクを合成すると、DB上は既に完了済みの実体行が
    // 「未着手の仮想タスク」として再生成され、ユーザーが触れた瞬間に決定的IDで upsert され
    // 実績(status/actualMinutes/memo等)を破壊する。false の間は仮想タスクを合成しない。
    // ※ tasks の取得に失敗した場合は false のままにする（「0件で読み込み完了」と誤認させない）。
    tasksLoaded: boolean;
    selectedTaskIds: string[];
    currentDate: string;
    setCurrentDate: (date: string) => void;
    addTask: (task: Task) => void;
    updateTask: (taskId: string, updates: Partial<Task>) => Promise<boolean>;
    duplicateTask: (taskId: string) => Promise<void>;
    deleteTask: (taskId: string) => void;
    bulkUpdateTasks: (taskIds: string[], updates: Partial<Task>) => void;
    bulkDeleteTasks: (taskIds: string[]) => Promise<void>;
    bulkAddTasks: (tasks: Task[]) => Promise<void>;
    toggleTaskSelection: (taskId: string) => void;
    clearSelection: () => void;
    reorderTasks: (taskIds: string[]) => Promise<void>;
    getMergedTasks: (date: string) => Task[];
    resetTaskSlice: () => void;
}

// セクション削除前に「そのセクションを参照している行数」をUIへ知らせるための型
export interface SectionReferenceCounts {
    tasks: number;
    routines: number;
}

export interface SectionSlice {
    sections: Section[];
    addSection: (section: Section) => Promise<void>;
    updateSection: (sectionId: string, updates: Partial<Section>) => Promise<void>;
    // reassignToSectionId は必須。null は「セクションなし（タスクをバックログへ）」を意味する。
    // 省略可にすると、呼び出し側が意図せずタスクを全て section_id: null にしてしまうため。
    deleteSection: (sectionId: string, reassignToSectionId: string | null) => Promise<void>;
    countSectionReferences: (sectionId: string) => Promise<SectionReferenceCounts>;
    rebuildSections: () => Promise<void>;
    resetSectionSlice: () => void;
}

export interface ProjectSlice {
    projects: Project[];
    addProject: (project: Omit<Project, 'ownerId' | 'memberIds' | 'roles'>) => Promise<void>;
    updateProject: (projectId: string, updates: Partial<Project>) => Promise<void>;
    deleteProject: (projectId: string) => Promise<void>;
    inviteMember: (projectId: string, email: string, role?: Exclude<HubRole, 'owner'>) => Promise<{ success: boolean; message: string }>;
    generateInviteLink: (projectId: string, email?: string, role?: Exclude<HubRole, 'owner'>) => Promise<{ success: boolean; joinLink?: string; message: string }>;
    joinProjectWithToken: (token: string) => Promise<{ success: boolean; projectId?: string; message: string }>;
    resetProjectSlice: () => void;
}

export interface RoutineSlice {
    routines: Routine[];
    addRoutine: (routine: Routine) => void;
    updateRoutine: (routineId: string, updates: Partial<Routine>) => void;
    deleteRoutine: (routineId: string) => void;
    resetRoutineSlice: () => void;
}

export interface TagSlice {
    tags: Tag[];
    addTag: (tag: Tag) => Promise<string>;
    updateTag: (tagId: string, updates: Partial<Tag>) => void;
    deleteTag: (tagId: string) => void;
    getUniqueTags: () => string[];
    resetTagSlice: () => void;
}

export interface ItemTemplateSlice {
    itemTemplates: ItemTemplate[];
    addItemTemplate: (template: ItemTemplate) => Promise<boolean>;
    updateItemTemplate: (templateId: string, updates: Partial<Pick<ItemTemplate, 'name' | 'items'>>) => Promise<boolean>;
    deleteItemTemplate: (templateId: string) => Promise<boolean>;
    resetItemTemplateSlice: () => void;
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
    resetNoteSlice: () => void;
}

export interface AuthSlice {
    user: AppUser | null;
    unsubscribe: (() => void) | null;
    setUser: (user: AppUser | null) => void;
    signOut: () => Promise<void>;
    resetStore: () => void;
}

// トースト通知（alert() はレンダラをブロックしてタブを固まらせるため、その代替）
export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
    id: string;
    message: string;
    type: ToastType;
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
    toasts: Toast[];
    showToast: (message: string, type?: ToastType) => void;
    dismissToast: (id: string) => void;
    resetUISlice: () => void;
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
    ItemTemplateSlice &
    NoteSlice &
    AuthSlice &
    UISlice &
    CalendarSlice &
    AISlice &
    GoalSlice &
    BillingSlice &
    WorkspaceSlice;
