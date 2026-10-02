import { StateCreator } from 'zustand';

import { formatLocalDate } from '@/lib/calendarService';
import { computeNextRun } from '@/lib/routineUtils';
import { createClient } from '@/lib/supabase/client';
import { getPersistedSectionForTime } from '@/lib/sectionUtils';
import { timeUpdate, toTimeOrNull, toUuidOrNull, uuidUpdate } from '@/lib/supabase/normalize';
import type { Routine } from '@/types';
import type { Database } from '@/types/supabase';
import { StoreState, RoutineSlice } from '../types';

function upcomingRun(
    routine: Pick<Routine, 'frequency' | 'daysOfWeek' | 'interval' | 'startDate'>,
    startDate: string,
): string {
    return computeNextRun(
        {
            frequency: routine.frequency,
            daysOfWeek: routine.daysOfWeek,
            interval: routine.interval,
            startDate,
        },
        formatLocalDate(),
    );
}

export const createRoutineSlice: StateCreator<StoreState, [], [], RoutineSlice> = (set, get) => ({
    routines: [],

    addRoutine: async (routine) => {
        const { user, sections } = get();
        if (!user) return false;

        const sectionForScheduledTime = routine.startTime
            ? getPersistedSectionForTime(sections, routine.startTime)
            : undefined;
        const startDate = routine.startDate || formatLocalDate();
        // フォームは nextRun を渡さない。未設定のまま INSERT すると
        // routines.next_run の NOT NULL（23502）で 400 になる。
        const nextRun = upcomingRun(routine, startDate);
        const persisted: Routine = {
            ...routine,
            startDate,
            nextRun,
            sectionId: sectionForScheduledTime ?? routine.sectionId,
        };
        const previous = get().routines.find((item) => item.id === persisted.id) ?? null;

        set((state) => ({
            routines: previous
                ? state.routines.map((item) => (item.id === persisted.id ? persisted : item))
                : [...state.routines, persisted],
        }));

        const payload: Database['public']['Tables']['routines']['Insert'] = {
            id: persisted.id,
            user_id: user.uid,
            title: persisted.title,
            frequency: persisted.frequency,
            days_of_week: persisted.daysOfWeek ?? null,
            interval: persisted.interval ?? null,
            start_date: startDate,
            next_run: nextRun,
            start_time: toTimeOrNull(persisted.startTime),
            section_id: toUuidOrNull(sectionForScheduledTime ?? routine.sectionId),
            estimated_minutes: persisted.estimatedMinutes,
            active: persisted.active,
            project_id: toUuidOrNull(persisted.projectId),
            tags: persisted.tags ?? [],
            memo: persisted.memo ?? null,
        };

        try {
            const { error } = await createClient().from('routines').insert(payload);
            if (error) {
                throw error;
            }
        } catch (error) {
            console.error('Error adding routine:', error);
            set((state) => ({
                routines: previous
                    ? state.routines.map((item) => (item.id === persisted.id ? previous : item))
                    : state.routines.filter((item) => item.id !== persisted.id),
            }));
            get().showToast('ルーチンを保存できませんでした。', 'error');
            return false;
        }
        return true;
    },

    updateRoutine: async (routineId, updates) => {
        const { routines, sections } = get();
        const currentRoutine = routines.find((routine) => routine.id === routineId);
        const placementChanged =
            Object.prototype.hasOwnProperty.call(updates, 'startTime')
            || Object.prototype.hasOwnProperty.call(updates, 'sectionId');
        let resolvedSectionId: string | undefined;

        if (placementChanged) {
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

        const scheduleChanged =
            Object.prototype.hasOwnProperty.call(updates, 'frequency')
            || Object.prototype.hasOwnProperty.call(updates, 'daysOfWeek')
            || Object.prototype.hasOwnProperty.call(updates, 'interval')
            || Object.prototype.hasOwnProperty.call(updates, 'startDate');
        const startDate = updates.startDate || currentRoutine?.startDate || formatLocalDate();
        const nextRun = scheduleChanged
            ? computeNextRun(
                {
                    frequency: updates.frequency ?? currentRoutine?.frequency ?? 'daily',
                    daysOfWeek: Object.prototype.hasOwnProperty.call(updates, 'daysOfWeek')
                        ? updates.daysOfWeek
                        : currentRoutine?.daysOfWeek,
                    interval: Object.prototype.hasOwnProperty.call(updates, 'interval')
                        ? updates.interval
                        : currentRoutine?.interval,
                    startDate,
                },
                formatLocalDate(),
            )
            : undefined;

        const payload: Database['public']['Tables']['routines']['Update'] = {
            title: updates.title,
            frequency: updates.frequency,
            days_of_week: updates.daysOfWeek === undefined ? undefined : updates.daysOfWeek ?? null,
            interval: updates.interval === undefined ? undefined : updates.interval ?? null,
            start_date: updates.startDate,
            next_run: nextRun,
            start_time: timeUpdate(updates.startTime),
            section_id: placementChanged ? uuidUpdate(resolvedSectionId) : undefined,
            estimated_minutes: updates.estimatedMinutes,
            active: updates.active,
            project_id: uuidUpdate(updates.projectId),
            tags: updates.tags,
            memo: updates.memo === undefined ? undefined : updates.memo ?? null,
        };

        try {
            const { error } = await createClient().from('routines').update(payload).eq('id', routineId);
            if (error) {
                throw error;
            }
        } catch (error) {
            console.error('Error updating routine:', error);
            get().showToast('ルーチンを保存できませんでした。', 'error');
            return false;
        }
        return true;
    },

    deleteRoutine: async (routineId) => {
        const { error } = await createClient().from('routines').delete().eq('id', routineId);
        if (error) {
            console.error('Error deleting routine:', error);
        }
    },

    resetRoutineSlice: () => set({ routines: [] }),
});
