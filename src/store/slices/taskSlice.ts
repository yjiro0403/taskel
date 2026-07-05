import { format } from 'date-fns';
import { StateCreator } from 'zustand';

import { createVirtualRoutineTaskId } from '@/lib/tasks/virtualTask';
import { routineOccursOn } from '@/lib/routineUtils';
import {
    bulkCreateTaskRecords,
    bulkReplaceTaskRecords,
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
    // ローカルタイムゾーン基準の当日。toISOString() は UTC 基準のため、JST では
    // 深夜0〜9時に「前日」を指してしまいルーチン表示とズレる。
    currentDate: format(new Date(), 'yyyy-MM-dd'),

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
            const virtualTask = currentTask
                ? undefined
                : getMergedTasks(currentDate).find((task) => task.id === taskId && task.isVirtual);
            const occurrence = currentTask ?? virtualTask;

            // ルーチンタスクの「日付移動」検知（データ破壊防止）。
            // ルーチン由来タスクは日付をエンコードした決定的UUIDを doc ID に持つため、
            // 日付だけ変更すると元日付に同一 ID の仮想タスクが再生成されて衝突し、その
            // 削除で移動先タスクを上書き破壊していた。対策: 日付移動時は元スロットを
            // スキップ化＋新規 UUID の独立タスクへデタッチ（routineId を外す）して衝突を根絶。
            const isRoutineOccurrence = !!occurrence && !!occurrence.routineId;
            const dateKeyPresent = Object.prototype.hasOwnProperty.call(updates, 'date');
            const dateChanging = dateKeyPresent && updates.date !== occurrence?.date;
            if (occurrence && isRoutineOccurrence && dateChanging && occurrence.routineId && occurrence.date) {
                const rid = occurrence.routineId;
                const origDate = occurrence.date;
                const slotId = createVirtualRoutineTaskId(rid, origDate);

                const skipMarker: Task = {
                    ...occurrence,
                    id: slotId,
                    routineId: rid,
                    date: origDate,
                    status: 'skipped',
                    userId: user.uid,
                    updatedAt: Date.now(),
                    isVirtual: undefined,
                };
                const detached: Task = {
                    ...occurrence,
                    ...updates,
                    id: crypto.randomUUID(),
                    routineId: undefined,
                    isVirtual: undefined,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    userId: user.uid,
                };

                set((state) => ({
                    tasks: [...state.tasks.filter((task) => task.id !== taskId), skipMarker, detached],
                }));

                if (currentTask && taskId !== slotId) {
                    await deleteTaskRecord(taskId);
                }
                await replaceTaskRecord(skipMarker, user.uid);
                await createTaskRecord(detached, user.uid);
                return;
            }

            // 仮想タスクの実体化（日付移動でない通常の編集・完了操作）
            if (!currentTask) {
                if (virtualTask) {
                    const fullTaskForCreation: Task = {
                        ...virtualTask,
                        ...updates,
                        userId: user.uid,
                    };
                    set((state) => ({ tasks: [...state.tasks, fullTaskForCreation] }));
                    await replaceTaskRecord(fullTaskForCreation, user.uid);
                    return;
                }
                console.error('Task not found for update:', taskId);
                return;
            }

            const isProjectChange = updates.projectId !== undefined && updates.projectId !== currentTask.projectId;

            if (isProjectChange) {
                await replaceTaskRecord({ ...currentTask, ...updates, userId: user.uid }, user.uid);
            } else {
                // クリア意図（明示的な undefined）を null に変換して永続化する。
                // updateTaskRow は undefined を省略・null をクリアとして扱うため、
                // 週/月ビューの「バックログへ戻す」等の date クリアが巻き戻らなくなる。
                const normalized: Record<string, unknown> = { ...updates };
                for (const key of Object.keys(normalized)) {
                    if (normalized[key] === undefined) normalized[key] = null;
                }
                await updateTaskRecord(taskId, normalized as Partial<Task>, user.uid);
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
        const { user, updateTask } = get();
        if (!user) {
            set((state) => ({
                tasks: state.tasks.map((task) => (taskIds.includes(task.id) ? { ...task, ...updates } : task)),
                selectedTaskIds: [],
            }));
            return;
        }

        // 従来は bulkUpdateTaskRows(SQL UPDATE .in()) を使っていたため、未実体化の
        // 仮想ルーチンタスクや未存在 doc は黙って無視され「一部が移動されない」不具合が
        // あった。仮想タスクの実体化・ルーチンのデタッチ・クリア処理を安全に扱うため、
        // 1件ずつ updateTask に委譲する（各件が独立して成否判定される）。
        for (const id of taskIds) {
            await updateTask(id, updates);
        }
        set({ selectedTaskIds: [] });
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
        const oldTasks = tasks;
        const newTasks = tasks.map((task) => {
            const newIndex = taskIds.indexOf(task.id);
            return newIndex >= 0 ? { ...task, order: newIndex } : task;
        });
        set({ tasks: newTasks });

        if (!user) {
            return;
        }

        // 書き込み中は realtime による巻き戻しを防止
        taskIds.forEach(addPendingTask);
        try {
            const reorderedTasks = newTasks
                .filter((task) => taskIds.includes(task.id))
                .map((task) => ({ ...task }));

            await bulkReplaceTaskRecords(reorderedTasks, user.uid);
        } catch (error) {
            console.error('Error reordering tasks:', error);
            // 失敗時はローカル順を巻き戻す（DBと画面の乖離を防ぐ）
            set({ tasks: oldTasks });
        } finally {
            taskIds.forEach(removePendingTask);
        }
    },

    getMergedTasks: (dateStr: string) => {
        const { tasks, routines } = get();
        const dbTasks = tasks.filter((task) => task.date === dateStr);
        const virtualTasks: Task[] = [];

        routines.forEach((routine) => {
            if (!routine.active) return;

            // 頻度判定は純粋関数 routineOccursOn に集約（月末繰り上げ含む・単体テスト対象）
            if (!routineOccursOn(routine, dateStr)) {
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
        currentDate: format(new Date(), 'yyyy-MM-dd'),
    }),
});
