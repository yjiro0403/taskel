import { StateCreator } from 'zustand';
import { StoreState, RoutineSlice } from '../types';
import { collection, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeData } from '../helpers/sanitize';
import { format } from 'date-fns';

// ルーティンCRUDスライス
export const createRoutineSlice: StateCreator<StoreState, [], [], RoutineSlice> = (set, get) => ({
    routines: [],

    addRoutine: async (routine) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(collection(db, 'users', user.uid, 'routines'), routine.id || undefined);
                const newRoutine = {
                    ...routine,
                    id: ref.id,
                    userId: user.uid,
                    startDate: routine.startDate || format(new Date(), 'yyyy-MM-dd')
                };
                await setDoc(ref, sanitizeData(newRoutine));
            } catch (error) {
                console.error("Error adding routine: ", error);
            }
        }
    },

    updateRoutine: async (routineId, updates) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(db, 'users', user.uid, 'routines', routineId);
                await updateDoc(ref, sanitizeData(updates));
            } catch (error) {
                console.error("Error updating routine: ", error);
            }
        }
    },

    deleteRoutine: async (routineId) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(db, 'users', user.uid, 'routines', routineId);
                await deleteDoc(ref);
            } catch (error) {
                console.error("Error deleting routine: ", error);
            }
        }
    },
});
