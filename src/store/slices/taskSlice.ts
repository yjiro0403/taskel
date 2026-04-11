import { parseISO, isBefore, isSameDay } from 'date-fns';
import { StateCreator } from 'zustand';

import { createVirtualRoutineTaskId } from '@/lib/tasks/virtualTask';
import {
    bulkCreateTaskRecords,
    bulkReplaceTaskRecords,
    bulkUpdateTaskRecords,
    createTaskRecord,
    deleteTaskRecord,
    replaceTaskRecord,
    updateTaskRecord,
} from '@/lib/supabase/repositories/taskRepository';
import { Task } from '@/types';
import { StoreState, TaskSlice } from '../types';
import { addPendingTask, removePendingTask } from '../helpers/pendingTasks';

export const createTaskSlice: StateCreator<StoreState, [], [], TaskSlice> = (set, get) => ({
    tasks: [],
    selectedTaskIds: [],
    currentDate: new Date().toISOString().split('T')[0],

    setCurrentDate: (date) => set({ currentDate: date }),

    addTask: async (task) => {
        const { user } = get();
        if (!user) {
            set((state) => ({ tasks: [...state.tasks, task] }));
            return;
        }

        const oldTasks = get().tasks;
        set((state) => ({ tasks: [...state.tasks, task] }));

        try {
            await createTaskRecord({ ...task, userId: user.uid }, user.uid);
        } catch (error) {
            console.error('Error adding task:', error);
            set({ tasks: oldTasks });
            alert('Failed to add task. Please check your connection.');
        }
    },

    updateTask: async (taskId, updates) => {
        const { user, tasks, getMergedTasks, currentDate } = get();
        if (!user) {
            set((state) => ({
                tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, ...updates } : task)),
            }));
            return;
        }

        const oldTasks = tasks;
        addPendingTask(taskId);
        set((state) => ({
            tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, ...updates } : task)),
        }));

        try {
            const currentTask = tasks.find((task) => task.id === taskId);
            let isVirtual = false;
            let fullTaskForCreation: Task | null = null;

            if (!currentTask) {
                const virtualTask = getMergedTasks(currentDate).find((task) => task.id === taskId && task.isVirtual);

                if (virtualTask) {
                    isVirtual = true;
                    fullTaskForCreation = {
                        ...virtualTask,
                        ...updates,
                        userId: user.uid,
                    };
                    set((state) => ({ tasks: [...state.tasks, fullTaskForCreation as Task] }));
                }
            }

            if (isVirtual && fullTaskForCreation) {
                await replaceTaskRecord(fullTaskForCreation, user.uid);
                return;
            }

            if (!currentTask) {
                console.error('Task not found for update:', taskId);
                return;
            }

            const isProjectChange = updates.projectId !== undefined && updates.projectId !== currentTask.projectId;

            if (isProjectChange) {
                await replaceTaskRecord({ ...currentTask, ...updates, userId: user.uid }, user.uid);
            } else {
                await updateTaskRecord(taskId, updates, user.uid);
            }
        } catch (error) {
            console.error('Error updating task:', error);
            set({ tasks: oldTasks });
            alert('Failed to update task. Please check your connection.');
        } finally {
            removePendingTask(taskId);
        }
    },

    duplicateTask: async (taskId: string) => {
        const { tasks, addTask, getMergedTasks, currentDate } = get();
        let task = tasks.find((entry) => entry.id === taskId);

        if (!task) {
            task = getMergedTasks(currentDate).find((entry) => entry.id === taskId);
        }

        if (!task) {
            return;
        }

        const sectionTasks = tasks
            .filter((entry) => entry.sectionId === task.sectionId && entry.date === task.date)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const taskIndex = sectionTasks.findIndex((entry) => entry.id === task.id);
        const nextTask = taskIndex >= 0 ? sectionTasks[taskIndex + 1] : undefined;
        const newOrder = nextTask
            ? ((task.order ?? 0) + (nextTask.order ?? 0)) / 2
            : (task.order ?? 0) + 1;

        const newTask: Task = {
            ...task,
            id: crypto.randomUUID(),
            title: `${task.title} (copy)`,
            status: 'open',
            actualMinutes: 0,
            startedAt: undefined,
            completedAt: undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            order: newOrder,
        };

        await addTask(newTask);
    },

    deleteTask: async (taskId) => {
        const { user, tasks, getMergedTasks, currentDate } = get();
        if (!user) {
            set((state) => ({ tasks: state.tasks.filter((task) => task.id !== taskId) }));
            return;
        }

        const oldTasks = tasks;
        set((state) => ({ tasks: state.tasks.filter((task) => task.id !== taskId) }));

        try {
            const virtualTask = getMergedTasks(currentDate).find((task) => task.id === taskId && task.isVirtual);
            if (virtualTask) {

                await replaceTaskRecord({
                    ...virtualTask,
                    userId: user.uid,
                    status: 'skipped',
                    updatedAt: Date.now(),
                    isVirtual: undefined,
                }, user.uid);
                return;
            }

            await deleteTaskRecord(taskId);
        } catch (error) {
            console.error('Error deleting task:', error);
            set({ tasks: oldTasks });
        }
    },

    bulkUpdateTasks: async (taskIds, updates) => {
        const { user, tasks } = get();
        if (!user) {
            set((state) => ({
                tasks: state.tasks.map((task) => (taskIds.includes(task.id) ? { ...task, ...updates } : task)),
                selectedTaskIds: [],
            }));
            return;
        }

        const oldTasks = tasks;
        const updatedTasks = tasks
            .filter((task) => taskIds.includes(task.id))
            .map((task) => ({ ...task, ...updates }));
        set((state) => ({
            tasks: state.tasks.map((task) => (taskIds.includes(task.id) ? { ...task, ...updates } : task)),
            selectedTaskIds: [],
        }));

        try {
            if (updates.tags !== undefined) {
                await bulkReplaceTaskRecords(updatedTasks, user.uid);
            } else {
                await bulkUpdateTaskRecords(taskIds, updates, user.uid);
            }
        } catch (error) {
            console.error('Error bulk updating tasks:', error);
            set({ tasks: oldTasks });
        }
    },

    bulkDeleteTasks: async (taskIds: string[]) => {
        const { user, tasks, getMergedTasks, currentDate } = get();
        if (!user) {
            set((state) => ({
                tasks: state.tasks.filter((task) => !taskIds.includes(task.id)),
                selectedTaskIds: [],
            }));
            return;
        }

        const oldTasks = tasks;
        set((state) => ({
            tasks: state.tasks.filter((task) => !taskIds.includes(task.id)),
            selectedTaskIds: [],
        }));

        try {
            for (const id of taskIds) {
                const virtualTask = getMergedTasks(currentDate).find((task) => task.id === id && task.isVirtual);

                if (virtualTask) {
                    await replaceTaskRecord({
                        ...virtualTask,
                        userId: user.uid,
                        status: 'skipped',
                        updatedAt: Date.now(),
                        isVirtual: undefined,
                    }, user.uid);
                    continue;
                }

                await deleteTaskRecord(id);
            }
        } catch (error) {
            console.error('Error bulk deleting tasks:', error);
            set({ tasks: oldTasks });
        }
    },

    bulkAddTasks: async (tasksToAdd) => {
        const { user } = get();
        if (!user) {
            set((state) => ({ tasks: [...state.tasks, ...tasksToAdd] }));
            return;
        }

        try {
            await bulkCreateTaskRecords(
                tasksToAdd.map((task) => ({
                    ...task,
                    id: task.id || crypto.randomUUID(),
                    userId: user.uid,
                    createdAt: task.createdAt || Date.now(),
                    updatedAt: Date.now(),
                })),
                user.uid
            );
        } catch (error) {
            console.error('Error bulk adding tasks:', error);
            throw error;
        }
    },

    toggleTaskSelection: (taskId) =>
        set((state) => ({
            selectedTaskIds: state.selectedTaskIds.includes(taskId)
                ? state.selectedTaskIds.filter((id) => id !== taskId)
                : [...state.selectedTaskIds, taskId],
        })),

    clearSelection: () => set({ selectedTaskIds: [] }),

    reorderTasks: async (taskIds: string[]) => {
        const { user, tasks } = get();
        const newTasks = tasks.map((task) => {
            const newIndex = taskIds.indexOf(task.id);
            return newIndex >= 0 ? { ...task, order: newIndex } : task;
        });
        set({ tasks: newTasks });

        if (!user) {
            return;
        }

        try {
            const reorderedTasks = newTasks
                .filter((task) => taskIds.includes(task.id))
                .map((task) => ({ ...task }));

            await bulkReplaceTaskRecords(reorderedTasks, user.uid);
        } catch (error) {
            console.error('Error reordering tasks:', error);
        }
    },

    getMergedTasks: (dateStr: string) => {
        const { tasks, routines } = get();
        const dbTasks = tasks.filter((task) => task.date === dateStr);
        const targetDate = parseISO(dateStr);
        const virtualTasks: Task[] = [];

        routines.forEach((routine) => {
            if (!routine.active) return;

            const startDate = parseISO(routine.startDate || routine.nextRun);
            if (isBefore(targetDate, startDate) && !isSameDay(targetDate, startDate)) return;

            let matches = false;
            if (routine.frequency === 'daily') {
                matches = true;
            } else if (routine.frequency === 'weekly') {
                if (routine.daysOfWeek && routine.daysOfWeek.length > 0) {
                    matches = routine.daysOfWeek.includes(targetDate.getDay());
                } else {
                    matches = targetDate.getDay() === startDate.getDay();
                }
            } else if (routine.frequency === 'monthly') {
                matches = targetDate.getDate() === startDate.getDate();
            } else if (routine.frequency === 'custom' && routine.interval) {
                const diffDays = Math.floor((targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                matches = diffDays >= 0 && diffDays % routine.interval === 0;
            }

            if (!matches) {
                return;
            }

            const deterministicId = createVirtualRoutineTaskId(routine.id, dateStr);
            const exists = dbTasks.some((task) => task.id === deterministicId || (task.routineId === routine.id && task.date === dateStr));
            if (exists) {
                return;
            }

            const sectionPeers = [
                ...dbTasks.filter((task) => task.sectionId === routine.sectionId),
                ...virtualTasks.filter((task) => task.sectionId === routine.sectionId),
            ];
            const maxPeerOrder = sectionPeers.length > 0
                ? Math.max(...sectionPeers.map((task) => task.order ?? 0))
                : 0;

            virtualTasks.push({
                id: deterministicId,
                userId: routine.userId,
                title: routine.title,
                sectionId: routine.sectionId,
                date: dateStr,
                status: 'open',
                estimatedMinutes: routine.estimatedMinutes,
                actualMinutes: 0,
                scheduledStart: routine.startTime,
                order: maxPeerOrder + 1,
                projectId: routine.projectId,
                routineId: routine.id,
                tags: routine.tags,
                memo: routine.memo,
                isVirtual: true,
            });
        });

        return [...dbTasks, ...virtualTasks].filter((task) => task.status !== 'skipped');
    },

    resetTaskSlice: () => set({
        tasks: [],
        selectedTaskIds: [],
        currentDate: new Date().toISOString().split('T')[0],
    }),
});
