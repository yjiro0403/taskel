import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import {
    fetchGoals,
    fetchNotes,
    fetchProjectById,
    fetchProjects,
    fetchRoutines,
    fetchSections,
    fetchTags,
    fetchTaskById,
    fetchTasks,
    subscribeTable,
    unsubscribeChannels,
} from '@/lib/supabase/data';
import { mapGoal, mapRoutine, mapSection, mapTag } from '@/lib/supabase/mappers';
import type { DailyNote, Goal, MonthlyNote, Routine, Section, Tag, WeeklyNote, YearlyNote } from '@/types';
import type { Database } from '@/types/supabase';
import { StoreState, AuthSlice } from '../types';
import { isPendingTask } from '../helpers/pendingTasks';

type Tables = Database['public']['Tables'];

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
    const nextItems = items.filter((item) => item.id !== nextItem.id);
    nextItems.push(nextItem);
    return nextItems;
}

function sortSections(sections: Section[]) {
    return [...sections].sort(
        (a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.order - b.order
    );
}

function upsertNote<T extends { id: string }>(items: T[], nextItem: T) {
    return upsertById(items, nextItem);
}

function buildInFilter(column: string, ids: string[]) {
    if (ids.length === 0) {
        return null;
    }

    return `${column}=in.(${ids.join(',')})`;
}

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => ({
    user: null,
    unsubscribe: null,

    resetStore: () => {
        get().resetTaskSlice();
        get().resetSectionSlice();
        get().resetProjectSlice();
        get().resetRoutineSlice();
        get().resetTagSlice();
        get().resetNoteSlice();
        get().resetGoalSlice();
        get().resetAISlice();
        get().resetBillingSlice();
        get().resetWorkspaceSlice();
        get().resetUISlice();
    },

    signOut: async () => {
        const existingUnsubscribe = get().unsubscribe;
        if (existingUnsubscribe) {
            existingUnsubscribe();
        }

        await createClient().auth.signOut();
        set({ user: null, unsubscribe: null });
        get().resetStore();
    },

    setUser: (user) => {
        const existingUnsubscribe = get().unsubscribe;
        if (existingUnsubscribe) {
            existingUnsubscribe();
        }

        set({ user, unsubscribe: null });

        if (!user) {
            get().resetStore();
            return;
        }

        const supabase = createClient();
        let disposed = false;
        let dataChannels = [] as ReturnType<typeof subscribeTable>[];
        let membershipChannel: ReturnType<typeof subscribeTable> | null = null;

        const refreshInitialState = async () => {
            try {
                const tags = await fetchTags(supabase);
                const [tasks, routines, sections, projects, goals, notes] = await Promise.all([
                    fetchTasks(supabase, tags),
                    fetchRoutines(supabase),
                    fetchSections(supabase),
                    fetchProjects(supabase),
                    fetchGoals(supabase),
                    fetchNotes(supabase),
                ]);

                if (disposed) {
                    return;
                }

                rebuildDataSubscriptions(
                    projects.map((project) => project.id),
                    tasks.map((task) => task.id)
                );

                set((state) => {
                    const localPendingTasks = state.tasks.filter((task) => isPendingTask(task.id));
                    const taskMap = new Map(tasks.map((task) => [task.id, task]));
                    localPendingTasks.forEach((task) => taskMap.set(task.id, task));

                    return {
                        tasks: Array.from(taskMap.values()),
                        tags,
                        routines,
                        sections: sortSections(sections),
                        projects,
                        goals,
                        dailyNotes: notes.dailyNotes,
                        weeklyNotes: notes.weeklyNotes,
                        monthlyNotes: notes.monthlyNotes,
                        yearlyNotes: notes.yearlyNotes,
                    };
                });

                if (sections.length === 0) {
                    const hasSeenOnboarding = localStorage.getItem('has_seen_onboarding');
                    if (!hasSeenOnboarding) {
                        localStorage.setItem('has_seen_onboarding', 'true');
                        await fetch('/api/onboarding', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({}),
                        });
                        await refreshInitialState();
                    }
                }
            } catch (error) {
                console.error('Failed to refresh Supabase state:', error);
            }
        };

        const replaceDataChannels = (nextChannels: ReturnType<typeof subscribeTable>[]) => {
            if (dataChannels.length > 0) {
                unsubscribeChannels(supabase, dataChannels);
            }
            dataChannels = nextChannels;
        };

        const syncTask = async (taskId: string, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => {
            if (disposed) {
                return;
            }

            if (eventType === 'DELETE') {
                set((state) => ({
                    tasks: state.tasks.filter((task) => task.id !== taskId),
                }));
                rebuildDataSubscriptions(
                    get().projects.map((project) => project.id),
                    get().tasks.filter((task) => task.id !== taskId).map((task) => task.id)
                );
                return;
            }

            try {
                const task = await fetchTaskById(supabase, taskId);
                if (!task || disposed) {
                    return;
                }

                set((state) => ({
                    // pending中（書き込み飛行中）のタスクはローカルの楽観的状態を優先し、
                    // realtime版で上書きしない。他の pending タスクも配列から除去せず保持する
                    // （従来は filter で無関係な pending タスクごと消し、ドラッグ/編集中の
                    // タスクが realtime イベント到来時に一瞬消える不具合があった）。
                    tasks: isPendingTask(task.id) ? state.tasks : upsertById(state.tasks, task),
                }));
                rebuildDataSubscriptions(
                    get().projects.map((project) => project.id),
                    get().tasks.map((entry) => entry.id)
                );
            } catch (error) {
                console.error('Failed to sync task:', error);
            }
        };

        const syncProject = async (projectId: string, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => {
            if (disposed) {
                return;
            }

            if (eventType === 'DELETE') {
                set((state) => ({
                    projects: state.projects.filter((project) => project.id !== projectId),
                }));
                return;
            }

            try {
                const project = await fetchProjectById(supabase, projectId);
                if (!project || disposed) {
                    return;
                }

                set((state) => ({
                    projects: upsertById(state.projects, project),
                }));
            } catch (error) {
                console.error('Failed to sync project:', error);
            }
        };

        const syncCollectionItem = <T extends { id: string }>(
            key: 'tags' | 'sections' | 'routines' | 'goals',
            mapper: (row: any) => T,
            payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: any; old: any }
        ) => {
            const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
            if (!row?.id) {
                return;
            }

            if (key === 'tags') {
                const mapped = mapper(row) as unknown as Tag;
                set((state) => ({
                    tags:
                        payload.eventType === 'DELETE'
                            ? state.tags.filter((tag) => tag.id !== row.id)
                            : upsertById(state.tags, mapped),
                }));
                return;
            }

            if (key === 'sections') {
                const mapped = mapper(row) as unknown as Section;
                set((state) => ({
                    sections:
                        payload.eventType === 'DELETE'
                            ? state.sections.filter((section) => section.id !== row.id)
                            : sortSections(upsertById(state.sections, mapped)),
                }));
                return;
            }

            if (key === 'routines') {
                const mapped = mapper(row) as unknown as Routine;
                set((state) => ({
                    routines:
                        payload.eventType === 'DELETE'
                            ? state.routines.filter((routine) => routine.id !== row.id)
                            : upsertById(state.routines, mapped),
                }));
                return;
            }

            const mapped = mapper(row) as unknown as Goal;
            set((state) => ({
                goals:
                    payload.eventType === 'DELETE'
                        ? state.goals.filter((goal) => goal.id !== row.id)
                        : upsertById(state.goals, mapped),
            }));
        };

        const syncNote = (
            payload: {
                eventType: 'INSERT' | 'UPDATE' | 'DELETE';
                new: Tables['notes']['Row'];
                old: Tables['notes']['Row'];
            }
        ) => {
            const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
            if (!row?.period_key) {
                return;
            }

            const mapped = {
                id: row.period_key,
                userId: row.user_id,
                content: row.content,
                updatedAt: new Date(row.updated_at).getTime(),
            };

            set((state) => {
                if (row.type === 'daily') {
                    return {
                        dailyNotes:
                            payload.eventType === 'DELETE'
                                ? state.dailyNotes.filter((note) => note.id !== mapped.id)
                                : upsertNote<DailyNote>(state.dailyNotes, mapped),
                    };
                }
                if (row.type === 'weekly') {
                    return {
                        weeklyNotes:
                            payload.eventType === 'DELETE'
                                ? state.weeklyNotes.filter((note) => note.id !== mapped.id)
                                : upsertNote<WeeklyNote>(state.weeklyNotes, mapped),
                    };
                }
                if (row.type === 'monthly') {
                    return {
                        monthlyNotes:
                            payload.eventType === 'DELETE'
                                ? state.monthlyNotes.filter((note) => note.id !== mapped.id)
                                : upsertNote<MonthlyNote>(state.monthlyNotes, mapped),
                    };
                }

                return {
                    yearlyNotes:
                        payload.eventType === 'DELETE'
                            ? state.yearlyNotes.filter((note) => note.id !== mapped.id)
                            : upsertNote<YearlyNote>(state.yearlyNotes, mapped),
                };
            });
        };

        const rebuildDataSubscriptions = (projectIds: string[], taskIds: string[]) => {
            const projectFilter = buildInFilter('id', projectIds);
            const projectScopedFilter = buildInFilter('project_id', projectIds);
            const taskTagFilter = buildInFilter('task_id', taskIds);

            const nextChannels = [
                subscribeTable(
                    supabase,
                    `tags:${user.uid}`,
                    'tags',
                    (payload) => syncCollectionItem('tags', mapTag, payload as any),
                    `user_id=eq.${user.uid}`
                ),
                subscribeTable(
                    supabase,
                    `tasks:personal:${user.uid}`,
                    'tasks',
                    (payload) => void syncTask((payload.new?.id ?? payload.old?.id) as string, payload.eventType),
                    `user_id=eq.${user.uid}`
                ),
                ...(projectScopedFilter ? [
                    subscribeTable(
                        supabase,
                        `tasks:projects:${user.uid}`,
                        'tasks',
                        (payload) => void syncTask((payload.new?.id ?? payload.old?.id) as string, payload.eventType),
                        projectScopedFilter
                    ),
                ] : []),
                ...(projectFilter ? [
                    subscribeTable(
                        supabase,
                        `projects:${user.uid}`,
                        'projects',
                        (payload) => void syncProject((payload.new?.id ?? payload.old?.id) as string, payload.eventType),
                        projectFilter
                    ),
                ] : []),
                subscribeTable(
                    supabase,
                    `routines:personal:${user.uid}`,
                    'routines',
                    (payload) => syncCollectionItem('routines', mapRoutine, payload as any),
                    `user_id=eq.${user.uid}`
                ),
                ...(projectScopedFilter ? [
                    subscribeTable(
                        supabase,
                        `routines:projects:${user.uid}`,
                        'routines',
                        (payload) => syncCollectionItem('routines', mapRoutine, payload as any),
                        projectScopedFilter
                    ),
                ] : []),
                subscribeTable(
                    supabase,
                    `sections:${user.uid}`,
                    'sections',
                    (payload) => syncCollectionItem('sections', mapSection, payload as any),
                    `user_id=eq.${user.uid}`
                ),
                subscribeTable(
                    supabase,
                    `goals:personal:${user.uid}`,
                    'goals',
                    (payload) => syncCollectionItem('goals', mapGoal, payload as any),
                    `user_id=eq.${user.uid}`
                ),
                ...(projectScopedFilter ? [
                    subscribeTable(
                        supabase,
                        `goals:projects:${user.uid}`,
                        'goals',
                        (payload) => syncCollectionItem('goals', mapGoal, payload as any),
                        projectScopedFilter
                    ),
                ] : []),
                subscribeTable(
                    supabase,
                    `notes:${user.uid}`,
                    'notes',
                    (payload) => syncNote(payload as any),
                    `user_id=eq.${user.uid}`
                ),
                subscribeTable(
                    supabase,
                    `task-tags:${user.uid}`,
                    'task_tags',
                    (payload) => {
                        const taskId = (payload.new?.task_id ?? payload.old?.task_id) as string | undefined;
                        if (!taskId) {
                            return;
                        }
                        void syncTask(taskId, payload.eventType === 'DELETE' ? 'UPDATE' : payload.eventType);
                    },
                    taskTagFilter ?? undefined
                ),
            ];

            replaceDataChannels(nextChannels);
        };

        void refreshInitialState();
        void get().fetchBillingInfo();
        rebuildDataSubscriptions(
            get().projects.map((project) => project.id),
            get().tasks.map((task) => task.id)
        );

        membershipChannel = subscribeTable(
            supabase,
            `project-members:${user.uid}`,
            'project_members',
            async (payload) => {
                const projectId = (payload.new?.project_id ?? payload.old?.project_id) as string | undefined;
                if (!projectId) {
                    return;
                }

                if (payload.eventType === 'DELETE') {
                    set((state) => ({
                        projects: state.projects.filter((project) => project.id !== projectId),
                        tasks: state.tasks.filter((task) => task.projectId !== projectId),
                        routines: state.routines.filter((routine) => routine.projectId !== projectId),
                        goals: state.goals.filter((goal) => goal.projectId !== projectId),
                    }));
                } else {
                    await syncProject(projectId, 'UPDATE');
                }

                rebuildDataSubscriptions(
                    get().projects.map((project) => project.id),
                    get().tasks.map((task) => task.id)
                );
            },
            `user_id=eq.${user.uid}`
        );

        set({
            unsubscribe: () => {
                disposed = true;
                if (membershipChannel) {
                    unsubscribeChannels(supabase, [membershipChannel]);
                }
                replaceDataChannels([]);
            },
        });
    },
});
