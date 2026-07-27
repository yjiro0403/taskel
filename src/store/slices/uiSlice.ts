import { StateCreator } from 'zustand';
import { FocusTaskResult, StoreState, Toast, UISlice } from '../types';
import { canEditTask } from '@/lib/tasks/canEditTask';
import { resolveTaskFocusLocation, TASK_HIGHLIGHT_MS } from '@/lib/tasks/focusTask';

// crypto.randomUUID が使えない実行環境（古いブラウザ / 一部テスト環境）でも
// トーストの id が衝突しないようにフォールバックを用意する。
let toastCounter = 0;
function createToastId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    toastCounter += 1;
    return `toast-${Date.now()}-${toastCounter}`;
}

/** Clears the temporary search/deep-link highlight after TASK_HIGHLIGHT_MS. */
let highlightClearTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleHighlightClear(set: (partial: Partial<StoreState>) => void) {
    if (highlightClearTimer) {
        clearTimeout(highlightClearTimer);
    }
    highlightClearTimer = setTimeout(() => {
        set({ highlightedTaskId: null });
        highlightClearTimer = null;
    }, TASK_HIGHLIGHT_MS);
}

// UI状態管理スライス（サイドバー、モーダル、時刻、トースト通知）
export const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set, get) => ({
    currentTime: new Date(),
    setCurrentTime: (time) => set({ currentTime: time }),

    isRightSidebarOpen: false,
    toggleRightSidebar: () => set((state) => ({ isRightSidebarOpen: !state.isRightSidebarOpen })),
    setRightSidebarOpen: (open) => set({ isRightSidebarOpen: open }),

    isLeftSidebarOpen: false,
    toggleLeftSidebar: () => set((state) => ({ isLeftSidebarOpen: !state.isLeftSidebarOpen })),

    isDailyNoteModalOpen: false,
    toggleDailyNoteModal: () => set((state) => ({ isDailyNoteModalOpen: !state.isDailyNoteModalOpen })),

    isAddTaskModalOpen: false,
    openAddTaskModal: () => set({ isAddTaskModalOpen: true }),
    closeAddTaskModal: () => set({ isAddTaskModalOpen: false }),

    isSearchModalOpen: false,
    openSearchModal: () => set({ isSearchModalOpen: true }),
    closeSearchModal: () => set({ isSearchModalOpen: false }),

    // 検索結果 / 恒久リンクからジャンプしたタスクを一時ハイライトする（TaskList / RightSidebar が参照）
    highlightedTaskId: null,
    setHighlightedTaskId: (taskId) => set({ highlightedTaskId: taskId }),

    // 恒久リンク等から Edit Item モーダルを開くためのペンディング ID
    pendingEditTaskId: null,
    setPendingEditTaskId: (taskId) => set({ pendingEditTaskId: taskId }),

    focusTask: (taskId, options = {}): FocusTaskResult => {
        const state = get();
        const occurrenceDate = options.date?.trim();
        const task =
            state.tasks.find((entry) => entry.id === taskId) ??
            (occurrenceDate
                ? state.getMergedTasks(occurrenceDate).find((entry) => entry.id === taskId)
                : undefined);
        if (!task) {
            return { status: 'not_found' };
        }

        const location = resolveTaskFocusLocation(task);
        const patch: Partial<StoreState> = {
            highlightedTaskId: taskId,
        };

        if (location.date) {
            patch.currentDate = location.date;
            patch.isRightSidebarOpen = false;
        } else {
            patch.isRightSidebarOpen = true;
        }

        // Deep links request openEdit, but must honor the same UI gate as TaskItem clicks.
        // Viewers can still land on / highlight the task; the Edit Item modal stays closed.
        let openedEdit = false;
        if (options.openEdit) {
            const allowed = canEditTask(task, state.user?.uid, state.projects);
            if (allowed) {
                patch.pendingEditTaskId = taskId;
                openedEdit = true;
            }
        }

        set(patch);
        scheduleHighlightClear(set);
        return { status: 'focused', openedEdit };
    },

    // トースト通知。alert() はレンダラをブロックしてタブごと固まらせるため、
    // 非ブロッキングな通知はすべてここへ集約する（表示は components/Toaster.tsx）。
    toasts: [],
    showToast: (message, type = 'info') => {
        const toast: Toast = { id: createToastId(), message, type };
        set((state) => ({ toasts: [...state.toasts, toast] }));
    },
    dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

    resetUISlice: () => {
        if (highlightClearTimer) {
            clearTimeout(highlightClearTimer);
            highlightClearTimer = null;
        }
        set({
            currentTime: new Date(),
            isRightSidebarOpen: false,
            isLeftSidebarOpen: false,
            isDailyNoteModalOpen: false,
            isAddTaskModalOpen: false,
            isSearchModalOpen: false,
            highlightedTaskId: null,
            pendingEditTaskId: null,
            toasts: [],
        });
    },
});
