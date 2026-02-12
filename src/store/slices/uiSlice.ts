import { StateCreator } from 'zustand';
import { StoreState, UISlice } from '../types';

// UI状態管理スライス（サイドバー、モーダル、時刻）
export const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set) => ({
    currentTime: new Date(),
    setCurrentTime: (time) => set({ currentTime: time }),

    isRightSidebarOpen: false,
    toggleRightSidebar: () => set((state) => ({ isRightSidebarOpen: !state.isRightSidebarOpen })),

    isLeftSidebarOpen: false,
    toggleLeftSidebar: () => set((state) => ({ isLeftSidebarOpen: !state.isLeftSidebarOpen })),

    isDailyNoteModalOpen: false,
    toggleDailyNoteModal: () => set((state) => ({ isDailyNoteModalOpen: !state.isDailyNoteModalOpen })),
});
