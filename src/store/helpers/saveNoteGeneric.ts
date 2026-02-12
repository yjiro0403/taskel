import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeData } from './sanitize';

// ノート（日次/週次/月次/年次）の汎用保存関数
export const saveNoteGeneric = async (
    collectionName: 'dailyNotes' | 'weeklyNotes' | 'monthlyNotes' | 'yearlyNotes',
    noteId: string,
    content: string,
    user: import('firebase/auth').User | null,
    set: any,
    get: any
) => {
    if (!user) return;

    // 楽観的更新
    const stateKey = collectionName;
    const note = {
        id: noteId,
        userId: user.uid,
        content,
        updatedAt: Date.now()
    };

    set((state: any) => {
        const existingIndex = state[stateKey].findIndex((n: any) => n.id === noteId);
        if (existingIndex >= 0) {
            const newNotes = [...state[stateKey]];
            newNotes[existingIndex] = note;
            return { [stateKey]: newNotes };
        } else {
            return { [stateKey]: [...state[stateKey], note] };
        }
    });

    try {
        const ref = doc(db, 'users', user.uid, collectionName, noteId);
        await setDoc(ref, sanitizeData(note), { merge: true });
    } catch (error) {
        console.error(`Error saving ${collectionName}:`, error);
    }
};
