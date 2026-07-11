import { format } from 'date-fns';
import { StateCreator } from 'zustand';

import { createVirtualRoutineTaskId } from '@/lib/tasks/virtualTask';
import { withClearedNullables } from '@/lib/tasks/clearedUpdates';
import { routineOccursOn } from '@/lib/routineUtils';
import {
    bulkCreateTaskRecords,
    bulkUpdateTaskOrderRecords,
    createTaskRecord,
    deleteTaskRecord,
    replaceTaskRecord,
    updateTaskRecord,
} from '@/lib/supabase/repositories/taskRepository';
import { Task } from '@/types';
import { StoreState, TaskSlice } from '../types';
import { addPendingTask, removePendingTask } from '../helpers/pendingTasks';

// 楽観的更新の失敗ロールバックを「影響を受けたタスクのみ」に限定するヘルパ。
// 従来は失敗時に tasks 配列全体を古いスナップショット(oldTasks)で上書きしていたため、
// 書き込み処理中に別デバイス/タブの realtime で届いた無関係タスクの更新まで巻き戻して
// ローカルから消してしまっていた。ここでは snapshot に載せた id だけを操作前の値へ戻し、
// それ以外の現在値（=最新の realtime 反映済み）はそのまま保持する。
//   snapshot: id -> 操作前の Task（null = 操作前は存在しなかった → ロールバックで除去する）
// 配列の並び順は変わり得るが、表示は order 列でソートされるため影響しない。
function rollbackTasks(current: Task[], snapshot: Map<string, Task | null>): Task[] {
    const kept = current.filter((task) => !snapshot.has(task.id));
    const restored: Task[] = [];
    snapshot.forEach((prev) => {
        if (prev) {
            restored.push(prev);
        }
    });
    return [...kept, ...restored];
}

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

        // 失敗時に巻き戻すのは追加した task.id のみ（操作前は非存在 → null）。
        const snapshot = new Map<string, Task | null>([[task.id, null]]);
        set((state) => ({ tasks: [...state.tasks, task] }));

        try {
            await createTaskRecord({ ...task, userId: user.uid }, user.uid);
        } catch (error) {
            console.error('Error adding task:', error);
            set((state) => ({ tasks: rollbackTasks(state.tasks, snapshot) }));
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

        // 失敗時の巻き戻しは「この操作で触れた id のみ」に限定する（無関係タスクの
        // realtime 更新を巻き込まないため）。まず対象 id の操作前状態を記録する。
        const snapshot = new Map<string, Task | null>([[taskId, tasks.find((task) => task.id === taskId) ?? null]]);
        // realtime による巻き戻し防止のため pending 登録した id を追跡し、finally で確実に解除する。
        const pendingIds = new Set<string>([taskId]);
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
                    // 元スロットの添付は削除する（[]）。移動先(detached)へは別IDで複製済みのため、
                    // ここで消えても添付は失われない。undefined だと元 attachments が残る。
                    attachments: [],
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
                    // 添付は移動先へ「新しい attachment.id」で複製する。元行の添付(同一ID)が
                    // 残ったまま detached を先に作成しても、attachments.id は全体でユニークな
                    // PK のため衝突しない（作成優先の原子性を安全に成立させる要）。
                    // storage_path/url 等は据え置きで実体ファイルはそのまま共有する。
                    attachments: (occurrence.attachments ?? []).map((attachment) => ({
                        ...attachment,
                        id: crypto.randomUUID(),
                    })),
                };
                // 実行中(in_progress)のまま日付移動すると 005 の単一アクティブ部分ユニーク
                // インデックスに違反して作成が失敗し得る。移動先は「別日に予定変更」の意味なので
                // open に落とし startedAt をクリアする（実績時間 actualMinutes は維持）。
                if (detached.status === 'in_progress') {
                    detached.status = 'open';
                    detached.startedAt = undefined;
                }

                // 触れる id を巻き戻し対象＆pending に登録する。
                snapshot.set(slotId, tasks.find((task) => task.id === slotId) ?? null);
                snapshot.set(detached.id, null);
                for (const id of [slotId, detached.id]) {
                    if (!pendingIds.has(id)) {
                        pendingIds.add(id);
                        addPendingTask(id);
                    }
                }

                set((state) => ({
                    tasks: [...state.tasks.filter((task) => task.id !== taskId), skipMarker, detached],
                }));

                // 【原子性の要】必ず「先に移動先(detached)を作成」→ 成功後に破壊的操作を行う。
                // これにより途中失敗でもタスクが DB から消える経路を無くす:
                //  1) createTaskRecord が失敗 → 元は一切変更されず無傷（ローカルは巻き戻し）。
                //  2) replaceTaskRecord(skip) が失敗 → detached は既に永続化済み。元も残るため
                //     最悪でも新旧日付への「重複表示」に留まる（可視・復旧可能。消失しない）。
                //  3) deleteTaskRecord が失敗 → 旧行が残るだけ（同上の重複）。detached は無事。
                await createTaskRecord(detached, user.uid);
                await replaceTaskRecord(skipMarker, user.uid);
                if (currentTask && taskId !== slotId) {
                    // materialized で slot と異なる実体行がある場合のみ、最後に旧行を削除する。
                    await deleteTaskRecord(taskId);
                }
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
                    // 実体化で新規に作る id は失敗時に除去する（操作前は非存在）。
                    snapshot.set(fullTaskForCreation.id, tasks.find((task) => task.id === fullTaskForCreation.id) ?? null);
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
                // クリア意図（明示的な undefined）を、DB上 nullable なフィールドに限り null へ
                // 変換して永続化する。updateTaskRow は undefined を省略・null をクリアとして
                // 扱うため、月ビューの「週↔月ゴール移動」等の assignedWeek/assignedMonth
                // クリアが巻き戻らなくなる。NOT NULL 列（date 等）は変換しない（制約違反防止）。
                // ※ date クリアによる「日次→バックログ移動」は tasks.date が NOT NULL の
                //   ままでは永続化できず、スキーマの nullable 化が必要（Phase 2 の課題）。
                const normalized = withClearedNullables(updates);
                await updateTaskRecord(taskId, normalized as Partial<Task>, user.uid);
            }
        } catch (error) {
            console.error('Error updating task:', error);
            set((state) => ({ tasks: rollbackTasks(state.tasks, snapshot) }));
            alert('Failed to update task. Please check your connection.');
        } finally {
            pendingIds.forEach(removePendingTask);
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

        // 失敗時は削除対象 id のみを元に戻す（無関係タスクの realtime 更新を巻き込まない）。
        const snapshot = new Map<string, Task | null>([[taskId, tasks.find((task) => task.id === taskId) ?? null]]);
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
            set((state) => ({ tasks: rollbackTasks(state.tasks, snapshot) }));
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

        // 失敗時は削除対象 id のみを元に戻す（無関係タスクの realtime 更新を巻き込まない）。
        const snapshot = new Map<string, Task | null>(
            taskIds.map((id) => [id, tasks.find((task) => task.id === id) ?? null])
        );
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
            set((state) => ({ tasks: rollbackTasks(state.tasks, snapshot) }));
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
        // 失敗時は並べ替えた id のみ order を元に戻す（無関係タスクの realtime 更新は保持）。
        const snapshot = new Map<string, Task | null>(
            taskIds.map((id) => [id, tasks.find((task) => task.id === id) ?? null])
        );
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
            // order 列だけを更新する。フルupsert(bulkReplaceTaskRecords)は buildTaskInsertPayload が
            // user_id を常に現在ユーザーで書くため、混在ビュー内の他ユーザー所有タスクを並べ替えると
            // 所有権を奪って RLS 前提を破壊する。order のみの部分更新でその破壊を根絶する。
            const orders = newTasks
                .filter((task) => taskIds.includes(task.id))
                .map((task) => ({ id: task.id, order: task.order ?? 0 }));

            await bulkUpdateTaskOrderRecords(orders);
        } catch (error) {
            console.error('Error reordering tasks:', error);
            // 失敗時は並べ替えた分の order だけ巻き戻す（DBと画面の乖離を防ぐ）。
            set((state) => ({ tasks: rollbackTasks(state.tasks, snapshot) }));
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
