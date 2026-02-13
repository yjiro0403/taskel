// AIパネル開閉状態管理スライス

import { StateCreator } from 'zustand';
import { StoreState } from '../types';

export interface AISlice {
    isAIPanelOpen: boolean;
    toggleAIPanel: () => void;
    setAIPanelOpen: (open: boolean) => void;
}

export const createAISlice: StateCreator<StoreState, [], [], AISlice> = (set) => ({
    isAIPanelOpen: false,
    toggleAIPanel: () => set((state) => ({ isAIPanelOpen: !state.isAIPanelOpen })),
    setAIPanelOpen: (open) => set({ isAIPanelOpen: open }),
});
