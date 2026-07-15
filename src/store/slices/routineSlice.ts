import { format } from 'date-fns';
import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import { getPersistedSectionForTime } from '@/lib/sectionUtils';
import { timeUpdate, toTimeOrNull, toUuidOrNull, uuidUpdate } from '@/lib/supabase/normalize';
import type { Database } from '@/types/supabase';
import { StoreState, RoutineSlice } from '../types';

export const createRoutineSlice: StateCreator<StoreState, [], [], RoutineSlice> = (set, get) => ({
    routines: [],

    addRoutine: async (routine) => {
        const { user, sections } = get();
        if (!user) return;

        const sectionForScheduledTime = routine.startTime
            ? getPersistedSectionForTime(sections, routine.startTime)
            : undefined;

        const payload: Database['public']['Tables']['routines']['Insert'] = {
            id: routine.id,
            user_id: user.uid,
            title: routine.title,
            frequency: routine.frequency,
            days_of_week: routine.daysOfWeek ?? null,
            interval: routine.interval ?? null,
            start_date: routine.startDate || format(new Date(), 'yyyy-MM-dd'),
            next_run: routine.nextRun,
            start_time: toTimeOrNull(routine.startTime),
            section_id: toUuidOrNull(sectionForScheduledTime ?? routine.sectionId),
            estimated_minutes: routine.estimatedMinutes,
            active: routine.active,
            project_id: toUuidOrNull(routine.projectId),
            tags: routine.tags ?? [],
            memo: routine.memo ?? null,
        };

        const { error } = await createClient().from('routines').insert(payload);
        if (error) {
            console.error('Error adding routine:', error);
        }
    },

    updateRoutine: async (routineId, updates) => {
        const { routines, sections } = get();
        const placementChanged =
            Object.prototype.hasOwnProperty.call(updates, 'startTime')
            || Object.prototype.hasOwnProperty.call(updates, 'sectionId');
        let resolvedSectionId: string | undefined;

        if (placementChanged) {
            const currentRoutine = routines.find((routine) => routine.id === routineId);
            const effectiveStartTime = Object.prototype.hasOwnProperty.call(updates, 'startTime')
                ? updates.startTime
                : currentRoutine?.startTime;
            const requestedSectionId = Object.prototype.hasOwnProperty.call(updates, 'sectionId')
                ? updates.sectionId
                : currentRoutine?.sectionId;

            resolvedSectionId = effectiveStartTime
                ? getPersistedSectionForTime(sections, effectiveStartTime) ?? requestedSectionId
                : requestedSectionId;
        }

        const payload: Database['public']['Tables']['routines']['Update'] = {
            title: updates.title,
            frequency: updates.frequency,
            days_of_week: updates.daysOfWeek === undefined ? undefined : updates.daysOfWeek ?? null,
            interval: updates.interval === undefined ? undefined : updates.interval ?? null,
            start_date: updates.startDate,
            next_run: updates.nextRun,
            start_time: timeUpdate(updates.startTime),
            section_id: placementChanged ? uuidUpdate(resolvedSectionId) : undefined,
            estimated_minutes: updates.estimatedMinutes,
            active: updates.active,
            project_id: uuidUpdate(updates.projectId),
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

    resetRoutineSlice: () => set({ routines: [] }),
});
