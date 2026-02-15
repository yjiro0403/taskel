// 楽観的更新中のタスクIDを追跡するモジュール
// Firestoreリスナーが更新中のタスクを上書きしないようにする

const pendingTaskIds = new Set<string>();

export function addPendingTask(taskId: string) {
    pendingTaskIds.add(taskId);
}

export function removePendingTask(taskId: string) {
    pendingTaskIds.delete(taskId);
}

export function isPendingTask(taskId: string): boolean {
    return pendingTaskIds.has(taskId);
}
