import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/types/supabase';
import { StoreState, NoteSlice } from '../types';

async function saveNote(
    userId: string,
    type: Database['public']['Enums']['note_type'],
    periodKey: string,
    content: string
) {
    // notes は id(PK) に加え unique(user_id, type, period_key)。id を送らない upsert は
    // 既定で PK 競合となり毎回 INSERT 扱いになるため、2回目の保存で unique 制約違反になる。
    // 競合キーを (user_id, type, period_key) に明示して『同一期間ノートの更新』を成立させる。
    const { error } = await createClient().from('notes').upsert(
        {
            user_id: userId,
            type,
            period_key: periodKey,
            content,
        },
        { onConflict: 'user_id,type,period_key' }
    );

    if (error) {
        throw error;
    }
}

export const createNoteSlice: StateCreator<StoreState, [], [], NoteSlice> = (set, get) => ({
    dailyNotes: [],
    weeklyNotes: [],
    monthlyNotes: [],
    yearlyNotes: [],

    saveDailyNote: async (date: string, content: string) => {
        const { user } = get();
        if (!user) return;

        try {
            await saveNote(user.uid, 'daily', date, content);
        } catch (error) {
            console.error('Error saving daily note:', error);
        }
    },

    saveWeeklyNote: async (weekId: string, content: string) => {
        const { user } = get();
        if (!user) return;

        try {
            await saveNote(user.uid, 'weekly', weekId, content);
        } catch (error) {
            console.error('Error saving weekly note:', error);
        }
    },

    saveMonthlyNote: async (monthId: string, content: string) => {
        const { user } = get();
        if (!user) return;

        try {
            await saveNote(user.uid, 'monthly', monthId, content);
        } catch (error) {
            console.error('Error saving monthly note:', error);
        }
    },

    saveYearlyNote: async (yearId: string, content: string) => {
        const { user } = get();
        if (!user) return;

        try {
            await saveNote(user.uid, 'yearly', yearId, content);
        } catch (error) {
            console.error('Error saving yearly note:', error);
        }
    },

    resetNoteSlice: () => set({
        dailyNotes: [],
        weeklyNotes: [],
        monthlyNotes: [],
        yearlyNotes: [],
    }),
});
