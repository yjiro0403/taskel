import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import {
    fetchGoals,
    fetchNotes,
    fetchProjects,
    fetchRoutines,
    fetchSections,
    fetchTags,
    fetchTasks,
    subscribeTable,
    unsubscribeChannels,
} from '@/lib/supabase/data';
import { StoreState, AuthSlice } from '../types';
import { isPendingTask } from '../helpers/pendingTasks';

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => ({
    user: null,
    unsubscribe: null,

    setUser: (user) => {
        const existingUnsubscribe = get().unsubscribe;
        if (existingUnsubscribe) {
            existingUnsubscribe();
        }

        set({ user, unsubscribe: null });

        if (!user) {
            set({
                tasks: [],
                routines: [],
                tags: [],
                sections: [],
                projects: [],
                goals: [],
                dailyNotes: [],
                weeklyNotes: [],
                monthlyNotes: [],
                yearlyNotes: [],
            });
            return;
        }

        const supabase = createClient();
        let disposed = false;
        let refreshTimer: ReturnType<typeof setTimeout> | null = null;

        const refreshAll = async () => {
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

                set((state) => {
                    const localPendingTasks = state.tasks.filter((task) => isPendingTask(task.id));
                    const taskMap = new Map(tasks.map((task) => [task.id, task]));
                    localPendingTasks.forEach((task) => taskMap.set(task.id, task));

                    return {
                        tasks: Array.from(taskMap.values()),
                        tags,
                        routines,
                        sections: sections.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.order - b.order),
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
                        await refreshAll();
                    }
                }
            } catch (error) {
                console.error('Failed to refresh Supabase state:', error);
            }
        };

        const scheduleRefresh = () => {
            if (disposed) {
                return;
            }

            if (refreshTimer) {
                clearTimeout(refreshTimer);
            }

            refreshTimer = setTimeout(() => {
                void refreshAll();
            }, 50);
        };

        void refreshAll();
        void get().fetchBillingInfo();

        const channels = [
            subscribeTable(supabase, `tags:${user.uid}`, 'tags', scheduleRefresh),
            subscribeTable(supabase, `tasks:${user.uid}`, 'tasks', scheduleRefresh),
            subscribeTable(supabase, `task-tags:${user.uid}`, 'task_tags', scheduleRefresh),
            subscribeTable(supabase, `projects:${user.uid}`, 'projects', scheduleRefresh),
            subscribeTable(supabase, `project-members:${user.uid}`, 'project_members', scheduleRefresh),
            subscribeTable(supabase, `routines:${user.uid}`, 'routines', scheduleRefresh),
            subscribeTable(supabase, `sections:${user.uid}`, 'sections', scheduleRefresh),
            subscribeTable(supabase, `goals:${user.uid}`, 'goals', scheduleRefresh),
            subscribeTable(supabase, `notes:${user.uid}`, 'notes', scheduleRefresh),
            subscribeTable(supabase, `invitations:${user.uid}`, 'invitations', scheduleRefresh),
        ];

        set({
            unsubscribe: () => {
                disposed = true;
                if (refreshTimer) {
                    clearTimeout(refreshTimer);
                }
                unsubscribeChannels(supabase, channels);
            },
        });
    },
});
