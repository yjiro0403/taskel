import { StateCreator } from 'zustand';
import { StoreState, TaskSlice } from '../types';
import { Task } from '@/types';
import {
    collection, doc, setDoc, deleteDoc,
    writeBatch, getDocs
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeData } from '../helpers/sanitize';
import { addPendingTask, removePendingTask } from '../helpers/pendingTasks';
import { format } from 'date-fns';
import { routineOccursOn } from '@/lib/routineUtils';

// タスクCRUD + 仮想タスク生成 + マイグレーション スライス
export const createTaskSlice: StateCreator<StoreState, [], [], TaskSlice> = (set, get) => ({
    tasks: [],
    selectedTaskIds: [],
    // ローカルタイムゾーン基準の当日。toISOString() は UTC 基準のため、JST では
    // 深夜0〜9時に「前日」を指してしまいルーチン表示とズレる（DateNavigation の
    // Today ボタンや getMergedTasks はローカル基準のため二重にズレる）。
    currentDate: format(new Date(), 'yyyy-MM-dd'),

    setCurrentDate: (date) => set({ currentDate: date }),

    addTask: async (task) => {
        const { user } = get();
        if (user) {
            // 楽観的更新
            const oldTasks = get().tasks;
            set((state) => ({ tasks: [...state.tasks, task] }));

            try {
                // BFFパターン: API経由でタスク作成
                const token = await user.getIdToken();
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
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
            // 楽観的更新中はFirestoreリスナーの上書きを防止
            addPendingTask(taskId);
            // 楽観的更新
            set((state) => ({
                tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
            }));

            try {
                const token = await user.getIdToken();
                const task = tasks.find(t => t.id === taskId);

                // 仮想（未実体化）ルーチンタスクの元データを解決
                let virtualTask: Task | undefined;
                if (!task && taskId.startsWith('routine-')) {
                    const dateStr = taskId.split('-').slice(-3).join('-');
                    virtualTask = getMergedTasks(dateStr).find(t => t.id === taskId);
                }
                const occurrence = task ?? virtualTask; // 実体化 or 仮想のいずれか

                // ルーチンタスクの「日付移動」検知（データ破壊防止）。
                // ルーチン由来タスクの ID は `routine-<rid>-<元日付>` で日付を内包する。
                // 日付だけ変更すると ID と date がズレ、元日付に同一 ID の仮想タスクが
                // 再生成されて衝突し、その削除で移動先タスクを上書き破壊していた。
                // 対策: 日付移動時は「元スロットをスキップ化」＋「新規 UUID の独立タスクへ
                // デタッチ（routineId を外す）」ことで ID 衝突を根絶する（仮想・実体化とも）。
                const isRoutineOccurrence = !!occurrence && (taskId.startsWith('routine-') || !!occurrence.routineId);
                const dateKeyPresent = Object.prototype.hasOwnProperty.call(updates, 'date');
                const dateChanging = dateKeyPresent && updates.date !== occurrence?.date;
                if (occurrence && isRoutineOccurrence && dateChanging && occurrence.routineId && occurrence.date) {
                    const rid = occurrence.routineId;
                    const origDate = occurrence.date;
                    const slotId = `routine-${rid}-${origDate}`;

                    // 1) 元スロットをスキップ化（再生成を抑止）
                    const skipMarker: Task = {
                        ...occurrence,
                        id: slotId,
                        routineId: rid,
                        date: origDate,
                        status: 'skipped',
                        userId: user.uid,
                        updatedAt: Date.now(),
                    };
                    // 2) 移動先へ独立タスクとして複製（routineId を外し新規 UUID）
                    const detached: Task = {
                        ...occurrence,
                        ...updates,
                        id: crypto.randomUUID(),
                        routineId: undefined,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        userId: user.uid,
                    };

                    // 楽観的更新: 元タスクを除去し、スキップマーカー＋独立タスクを反映
                    set((state) => ({
                        tasks: [...state.tasks.filter((t) => t.id !== taskId), skipMarker, detached],
                    }));

                    // 元 doc が slotId と異なる場合（既に UUID 化済み等）は旧 doc を削除
                    if (task && taskId !== slotId) {
                        await deleteDoc(doc(db, 'tasks', taskId));
                    }
                    // スキップマーカーを永続化（クライアント SDK: 自己所有の単純ドキュメント）
                    await setDoc(doc(db, 'tasks', slotId), sanitizeData(skipMarker));
                    // 独立タスクを作成（BFF API）
                    const detachRes = await fetch('/api/tasks', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ task: detached, action: 'create' }),
                    });
                    if (!detachRes.ok) throw new Error('Failed to detach routine task');
                    return;
                }

                // 仮想タスクのインスタンス化（日付移動でない通常の編集・完了操作）
                if (!task) {
                    if (virtualTask) {
                        const fullTaskForCreation: Task = {
                            ...virtualTask,
                            ...updates,
                            userId: user.uid,
                        };
                        set((state) => ({ tasks: [...state.tasks, fullTaskForCreation] }));
                        const response = await fetch('/api/tasks', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${token}`,
                            },
                            body: JSON.stringify({ task: fullTaskForCreation, action: 'create' })
                        });
                        if (!response.ok) throw new Error('Failed to instantiate task via API');
                        return;
                    }
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

                // クリア意図（undefined）を null センチネルに変換して API に伝える。
                // JSON では undefined が脱落するため、そのままだと date/assignedWeek 等の
                // 「バックログへ戻す」クリアが永続化されず巻き戻る。API 側で
                // null→FieldValue.delete() に変換される。
                if (payloadAction === 'update') {
                    for (const k of Object.keys(payloadTask)) {
                        if (payloadTask[k] === undefined) payloadTask[k] = null;
                    }
                }

                // BFFパターン: API経由で更新
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
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
            } finally {
                removePendingTask(taskId);
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
            // 同セクション内で元タスクの直後にあるタスクを探してmidpointを算出
            const sectionTasks = tasks
                .filter(t => t.sectionId === task.sectionId && t.date === task.date)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            const taskIndex = sectionTasks.findIndex(t => t.id === task.id);
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
        const { user, updateTask } = get();
        if (user) {
            // 従来は writeBatch.update を使っていたため、未実体化の仮想ルーチンタスクや
            // 未作成 doc が1件でも含まれるとバッチ全体が失敗し「全件移動されない」
            // 不具合があった。仮想タスクの実体化・ルーチンのデタッチ・未存在ドキュメントを
            // 安全に扱うため、1件ずつ updateTask に委譲する（各件が独立して成否判定される）。
            for (const id of taskIds) {
                await updateTask(id, updates);
            }
            set({ selectedTaskIds: [] });
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
        const oldTasks = tasks;

        // 楽観的更新（配列順に order 0,1,2... を割り当て）
        const newTasks = tasks.map(t => {
            const newIndex = taskIds.indexOf(t.id);
            if (newIndex >= 0) {
                return { ...t, order: newIndex };
            }
            return t;
        });
        set({ tasks: newTasks });

        if (user) {
            // 書き込み中は Firestore リスナーによる巻き戻しを防止
            taskIds.forEach(addPendingTask);
            try {
                const batch = writeBatch(db);
                taskIds.forEach((id, index) => {
                    const ref = doc(db, 'tasks', id);
                    // update() は未存在 doc でバッチ全体を失敗させるため set(merge) を使う
                    batch.set(ref, { order: index, updatedAt: Date.now() }, { merge: true });
                });
                await batch.commit();
            } catch (error) {
                console.error("Error reordering tasks: ", error);
                // 失敗時はローカル順を巻き戻す（DBと画面の乖離を防ぐ）
                set({ tasks: oldTasks });
            } finally {
                taskIds.forEach(removePendingTask);
            }
        }
    },

    getMergedTasks: (dateStr: string) => {
        const { tasks, routines } = get();
        // 1. 該当日のDBタスクを取得（skipped含む）
        const dbTasks = tasks.filter(t => t.date === dateStr);

        const virtualTasks: Task[] = [];

        routines.forEach(routine => {
            if (!routine.active) return;

            // 頻度判定は純粋関数 routineOccursOn に集約（単体テスト対象）
            const matches = routineOccursOn(routine, dateStr);

            if (matches) {
                const deterministicId = `routine-${routine.id}-${dateStr}`;
                const exists = dbTasks.some(t => t.id === deterministicId || t.routineId === routine.id);

                if (!exists) {
                    // 同セクション内の既存タスク+仮想タスクから最大orderを算出
                    const sectionPeers = [
                        ...dbTasks.filter(t => t.sectionId === routine.sectionId),
                        ...virtualTasks.filter(t => t.sectionId === routine.sectionId),
                    ];
                    const maxPeerOrder = sectionPeers.length > 0
                        ? Math.max(...sectionPeers.map(t => t.order ?? 0))
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
