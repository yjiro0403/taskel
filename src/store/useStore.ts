// Zustandスライスパターンによるメインストア
// 各ドメインスライスを結合して統合ストアを構成

import { create } from 'zustand';
import { StoreState } from './types';
import { createTaskSlice } from './slices/taskSlice';
import { createSectionSlice } from './slices/sectionSlice';
import { createProjectSlice } from './slices/projectSlice';
import { createRoutineSlice } from './slices/routineSlice';
import { createTagSlice } from './slices/tagSlice';
import { createNoteSlice } from './slices/noteSlice';
import { createAuthSlice } from './slices/authSlice';
import { createUISlice } from './slices/uiSlice';
import { createCalendarSlice } from './slices/calendarSlice';

export const useStore = create<StoreState>()((...a) => ({
    ...createTaskSlice(...a),
    ...createSectionSlice(...a),
    ...createProjectSlice(...a),
    ...createRoutineSlice(...a),
    ...createTagSlice(...a),
    ...createNoteSlice(...a),
    ...createAuthSlice(...a),
    ...createUISlice(...a),
    ...createCalendarSlice(...a),
}));
