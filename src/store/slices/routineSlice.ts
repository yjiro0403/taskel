import { format } from 'date-fns';
import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/types/supabase';
import { StoreState, RoutineSlice } from '../types';

export const createRoutineSlice: StateCreator<StoreState, [], [], RoutineSlice> = (set, get) => ({
    routines: [],

    addRoutine: async (routine) => {
        const { user } = get();
        if (!user) return;

        const payload: Database['public']['Tables']['routines']['Insert'] = {
            id: routine.id,
            user_id: user.uid,
            title: routine.title,
            frequency: routine.frequency,
            days_of_week: routine.daysOfWeek ?? null,
            interval: routine.interval ?? null,
            start_date: routine.startDate || format(new Date(), 'yyyy-MM-dd'),
            next_run: routine.nextRun,
            start_time: routine.startTime ?? null,
            section_id: routine.sectionId,
            estimated_minutes: routine.estimatedMinutes,
            active: routine.active,
            project_id: routine.projectId ?? null,
            tags: routine.tags ?? [],
            memo: routine.memo ?? null,
        };

        const { error } = await createClient().from('routines').insert(payload);
        if (error) {
            console.error('Error adding routine:', error);
        }
    },

    updateRoutine: async (routineId, updates) => {
        const payload: Database['public']['Tables']['routines']['Update'] = {
            title: updates.title,
            frequency: updates.frequency,
            days_of_week: updates.daysOfWeek === undefined ? undefined : updates.daysOfWeek ?? null,
            interval: updates.interval === undefined ? undefined : updates.interval ?? null,
            start_date: updates.startDate,
            next_run: updates.nextRun,
            start_time: updates.startTime === undefined ? undefined : updates.startTime ?? null,
            section_id: updates.sectionId,
            estimated_minutes: updates.estimatedMinutes,
            active: updates.active,
            project_id: updates.projectId === undefined ? undefined : updates.projectId ?? null,
            tags: updates.tags,
            memo: updates.memo === undefined ? undefined : updates.memo ?? null,
        };

        const { error } = await createClient().from('routines').update(payload).eq('id', routineId);
        if (error) {
            console.error('Error updating routine:', error);
        }
    },

    deleteRoutine: async (routineId) => {
        const { error } = await createClient().from('routines').delete().eq('id', routineId);
        if (error) {
            console.error('Error deleting routine:', error);
        }
    },
});
