import { StateCreator } from 'zustand';
import { StoreState, TaskSlice } from '../types';
import { Task } from '@/types';
import {
    collection, doc, setDoc, deleteDoc,
    writeBatch, getDocs
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeData } from '../helpers/sanitize';
import { parseISO, isBefore, isSameDay } from 'date-fns';

// タスクCRUD + 仮想タスク生成 + マイグレーション スライス
export const createTaskSlice: StateCreator<StoreState, [], [], TaskSlice> = (set, get) => ({
    tasks: [],
    selectedTaskIds: [],
    currentDate: new Date().toISOString().split('T')[0],

    setCurrentDate: (date) => set({ currentDate: date }),

    addTask: async (task) => {
        const { user } = get();
        if (user) {
            // 楽観的更新
            const oldTasks = get().tasks;
            set((state) => ({ tasks: [...state.tasks, task] }));

            try {
                // BFFパターン: API経由でタスク作成
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task: { ...task, userId: user.uid }, action: 'create' })
                });

                if (!response.ok) {
                    throw new Error('Failed to create task via API');
                }
            } catch (error) {
                console.error("Error adding task via API: ", error);
                // 楽観的更新のロールバック
                set({ tasks: oldTasks });
                alert("Failed to add task. Please check your connection.");
            }
        } else {
            set((state) => ({ tasks: [...state.tasks, task] }));
        }
    },

    updateTask: async (taskId, updates) => {
        const { user, tasks, getMergedTasks } = get();
        if (user) {
            const oldTasks = tasks;
            // 楽観的更新
            set((state) => ({
                tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
            }));

            try {
                const task = tasks.find(t => t.id === taskId);
                let isVirtual = false;
                let fullTaskForCreation: Task | null = null;

                // 仮想タスクのインスタンス化ロジック
                if (!task) {
                    const dateStr = taskId.split('-').slice(-3).join('-');
                    const merged = getMergedTasks(dateStr);
                    const virtualTask = merged.find(t => t.id === taskId);

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
                    const response = await fetch('/api/tasks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ task: fullTaskForCreation, action: 'create' })
                    });
                    if (!response.ok) throw new Error('Failed to instantiate task via API');
                    return;
                }

                if (!task && !isVirtual) {
                    console.error("Task not found for update:", taskId);
                    return;
                }

                // プロジェクト移動の検出
                const isProjectChange = updates.projectId !== undefined && updates.projectId !== task?.projectId;
                const payloadAction = isProjectChange ? 'create' : 'update';

                let payloadTask: any = {
                    id: taskId,
                    userId: user.uid,
                    projectId: task?.projectId,
                    ...updates
                };

                if (isProjectChange && task) {
                    payloadTask = {
                        ...task,
                        ...updates,
                        userId: user.uid
                    };
                }

                // BFFパターン: API経由で更新
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        task: payloadTask,
                        action: payloadAction
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to update task via API');
                }
            } catch (error) {
                console.error("Error updating task via API: ", error);
                set({ tasks: oldTasks });
                alert("Failed to update task. Please check your connection.");
            }
        } else {
            set((state) => ({
                tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
            }));
        }
    },

    duplicateTask: async (taskId: string) => {
        const { tasks, addTask, getMergedTasks, currentDate } = get();
        let task = tasks.find(t => t.id === taskId);

        // フォールバック: 仮想タスクのチェック
        if (!task) {
            const mergedTasks = getMergedTasks(currentDate);
            task = mergedTasks.find(t => t.id === taskId);
        }

        if (task) {
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
                order: task.order + 0.1,
            };
            await addTask(newTask);
        }
    },

    deleteTask: async (taskId) => {
        const { user, getMergedTasks } = get();
        if (user) {
            try {
                // ルーティン由来の仮想タスクの処理
                if (taskId.startsWith('routine-')) {
                    const dateStr = taskId.split('-').slice(-3).join('-');
                    const merged = getMergedTasks(dateStr);
                    const virtualTask = merged.find(t => t.id === taskId);

                    if (virtualTask) {
                        const skippedTask = {
                            ...virtualTask,
                            userId: user.uid,
                            status: 'skipped' as const,
                            updatedAt: Date.now()
                        };
                        const ref = doc(db, 'tasks', taskId);
                        await setDoc(ref, sanitizeData(skippedTask));
                    }
                } else {
                    const ref = doc(db, 'tasks', taskId);
                    await deleteDoc(ref);
                }
            } catch (error) {
                console.error("Error deleting task: ", error);
            }
        } else {
            set((state) => ({
                tasks: state.tasks.filter((t) => t.id !== taskId),
            }));
        }
    },

    bulkUpdateTasks: async (taskIds, updates) => {
        const { user } = get();
        if (user) {
            try {
                const batch = writeBatch(db);
                taskIds.forEach((id) => {
                    const ref = doc(db, 'tasks', id);
                    batch.update(ref, sanitizeData({
                        ...updates,
                        updatedAt: Date.now()
                    }));
                });
                await batch.commit();
                set({ selectedTaskIds: [] });
            } catch (error) {
                console.error("Error bulk updating tasks: ", error);
            }
        } else {
            set((state) => ({
                tasks: state.tasks.map((t) => (taskIds.includes(t.id) ? { ...t, ...updates } : t)),
                selectedTaskIds: [],
            }));
        }
    },

    bulkDeleteTasks: async (taskIds: string[]) => {
        const { user, getMergedTasks } = get();
        if (user) {
            try {
                const batch = writeBatch(db);

                for (const id of taskIds) {
                    if (id.startsWith('routine-')) {
                        const parts = id.split('-');
                        if (parts.length >= 5) {
                            const dateStr = parts.slice(-3).join('-');
                            const merged = getMergedTasks(dateStr);
                            const virtualTask = merged.find(t => t.id === id);

                            if (virtualTask) {
                                const skippedTask = {
                                    ...virtualTask,
                                    userId: user.uid,
                                    status: 'skipped' as const,
                                    updatedAt: Date.now()
                                };
                                const ref = doc(db, 'tasks', id);
                                batch.set(ref, sanitizeData(skippedTask));
                            }
                        }
                    } else {
                        const ref = doc(db, 'tasks', id);
                        batch.delete(ref);
                    }
                }

                await batch.commit();
                set({ selectedTaskIds: [] });
            } catch (error) {
                console.error("Error bulk deleting tasks: ", error);
            }
        } else {
            set((state) => ({
                tasks: state.tasks.filter((t) => !taskIds.includes(t.id)),
                selectedTaskIds: [],
            }));
        }
    },

    bulkAddTasks: async (tasksToAdd) => {
        const { user } = get();
        if (user) {
            try {
                const batch = writeBatch(db);
                tasksToAdd.forEach(task => {
                    const ref = doc(db, 'tasks', task.id || crypto.randomUUID());
                    batch.set(ref, sanitizeData({
                        ...task,
                        id: ref.id,
                        userId: user.uid,
                        createdAt: task.createdAt || Date.now(),
                        updatedAt: Date.now()
                    }));
                });
                await batch.commit();
            } catch (error) {
                console.error("Error bulk adding tasks: ", error);
                throw error;
            }
        } else {
            set((state) => ({ tasks: [...state.tasks, ...tasksToAdd] }));
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
        // 楽観的更新
        const newTasks = tasks.map(t => {
            const newIndex = taskIds.indexOf(t.id);
            if (newIndex >= 0) {
                return { ...t, order: newIndex };
            }
            return t;
        });
        set({ tasks: newTasks });

        if (user) {
            try {
                const batch = writeBatch(db);
                taskIds.forEach((id, index) => {
                    const ref = doc(db, 'tasks', id);
                    batch.update(ref, { order: index, updatedAt: Date.now() });
                });
                await batch.commit();
            } catch (error) {
                console.error("Error reordering tasks: ", error);
            }
        }
    },

    getMergedTasks: (dateStr: string) => {
        const { tasks, routines } = get();
        // 1. 該当日のDBタスクを取得（skipped含む）
        const dbTasks = tasks.filter(t => t.date === dateStr);

        // 2. 対象日を設定
        const targetDate = parseISO(dateStr);
        const virtualTasks: Task[] = [];

        routines.forEach(routine => {
            if (!routine.active) return;
            const startDate = parseISO(routine.startDate || routine.nextRun);
            if (isBefore(targetDate, startDate) && !isSameDay(targetDate, startDate)) return;

            // 頻度のチェック
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

            if (matches) {
                const deterministicId = `routine-${routine.id}-${dateStr}`;
                const exists = dbTasks.some(t => t.id === deterministicId || t.routineId === routine.id);

                if (!exists) {
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
                        order: 999,
                        projectId: routine.projectId,
                        routineId: routine.id,
                        tags: routine.tags,
                        memo: routine.memo
                    });
                }
            }
        });

        // 3. skippedを除外して返却
        return [...dbTasks, ...virtualTasks].filter(t => t.status !== 'skipped');
    },

    migrateTasks: async () => {
        const { user } = get();
        if (!user) return { success: false, message: 'Not logged in', count: 0 };

        try {
            const batch = writeBatch(db);
            let count = 0;

            // プライベートサブコレクションからグローバルコレクションへの移行
            const privateTasksRef = collection(db, 'users', user.uid, 'tasks');
            const taskSnapshot = await getDocs(privateTasksRef);

            if (!taskSnapshot.empty) {
                taskSnapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    const newRef = doc(db, 'tasks', docSnap.id);
                    batch.set(newRef, {
                        ...data,
                        id: docSnap.id,
                        userId: user.uid,
                        updatedAt: Date.now()
                    });
                    count++;
                });
            }

            if (count > 0) {
                await batch.commit();
            }
            return { success: true, message: `Migrated ${count} tasks`, count };
        } catch (error) {
            console.error("Migration failed", error);
            return { success: false, message: 'Migration failed', count: 0 };
        }
    },
});
