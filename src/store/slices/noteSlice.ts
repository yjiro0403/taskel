import { StateCreator } from 'zustand';
import { StoreState, NoteSlice } from '../types';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeData } from '../helpers/sanitize';
import { saveNoteGeneric } from '../helpers/saveNoteGeneric';

// ノート管理スライス（日次/週次/月次/年次）
export const createNoteSlice: StateCreator<StoreState, [], [], NoteSlice> = (set, get) => ({
    dailyNotes: [],
    weeklyNotes: [],
    monthlyNotes: [],
    yearlyNotes: [],

    saveDailyNote: async (date: string, content: string) => {
        const { user } = get();
        if (!user) return;
        const noteId = date;
        const noteRef = doc(db, 'users', user.uid, 'dailyNotes', noteId);
        try {
            await setDoc(noteRef, sanitizeData({
                id: noteId,
                userId: user.uid,
                content,
                updatedAt: Date.now()
            }), { merge: true });
        } catch (e) {
            console.error("Error saving daily note:", e);
        }
    },

    saveWeeklyNote: async (weekId: string, content: string) => {
        const { user } = get();
        if (!user) return;
        const noteRef = doc(db, 'users', user.uid, 'weeklyNotes', weekId);
        try {
            await setDoc(noteRef, sanitizeData({
                id: weekId,
                userId: user.uid,
                content,
                updatedAt: Date.now()
            }), { merge: true });
        } catch (e) {
            console.error("Error saving weekly note:", e);
        }
    },

    saveMonthlyNote: async (monthId: string, content: string) => {
        const { user } = get();
        await saveNoteGeneric('monthlyNotes', monthId, content, user, set, get);
    },

    saveYearlyNote: async (yearId: string, content: string) => {
        const { user } = get();
        await saveNoteGeneric('yearlyNotes', yearId, content, user, set, get);
    },
});
