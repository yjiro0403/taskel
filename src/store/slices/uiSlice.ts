import { StateCreator } from 'zustand';
import { StoreState, Toast, UISlice } from '../types';

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

// UI状態管理スライス（サイドバー、モーダル、時刻、トースト通知）
export const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set) => ({
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

    // 検索結果からジャンプしたタスクを一時ハイライトする（TaskList / RightSidebar が参照）
    highlightedTaskId: null,
    setHighlightedTaskId: (taskId) => set({ highlightedTaskId: taskId }),

    // トースト通知。alert() はレンダラをブロックしてタブごと固まらせるため、
    // 非ブロッキングな通知はすべてここへ集約する（表示は components/Toaster.tsx）。
    toasts: [],
    showToast: (message, type = 'info') => {
        const toast: Toast = { id: createToastId(), message, type };
        set((state) => ({ toasts: [...state.toasts, toast] }));
    },
    dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

    resetUISlice: () => set({
        currentTime: new Date(),
        isRightSidebarOpen: false,
        isLeftSidebarOpen: false,
        isDailyNoteModalOpen: false,
        isAddTaskModalOpen: false,
        isSearchModalOpen: false,
        highlightedTaskId: null,
        toasts: [],
    }),
});
