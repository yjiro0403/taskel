import type { Task } from '@/types';

export type WorkActor = 'human' | 'ai';

/** Fields the handoff needs. Callers may pass a full task. */
export type ActorClock = {
    status?: Task['status'];
    actualMinutes?: number;
    aiMinutes?: number;
    /** AI minutes closed inside the current run, not yet part of actualMinutes. */
    segmentAiMinutes?: number;
    workActor?: WorkActor;
    startedAt?: number;
    actorSince?: number;
};

export function workActorOf(task: { workActor?: WorkActor } | null | undefined): WorkActor {
    return task?.workActor === 'ai' ? 'ai' : 'human';
}

function wholeMinutes(value: number | undefined): number {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.round(numeric));
}

/**
 * Closed logged time. AI minutes never exceed the total, so a segment that is
 * still inside a running timer (segmentAiMinutes) stays out of this split.
 */
export function splitLoggedMinutes(task: { actualMinutes?: number; aiMinutes?: number }): {
    human: number;
    ai: number;
    total: number;
} {
    const total = wholeMinutes(task.actualMinutes);
    const ai = Math.min(total, wholeMinutes(task.aiMinutes));
    return { human: total - ai, ai, total };
}

/** Stamp the open segment when a timer starts. */
export function startedRunFields(nowMs: number): Pick<Task, 'actorSince' | 'segmentAiMinutes'> {
    return { actorSince: nowMs, segmentAiMinutes: 0 };
}

/**
 * Flip who the next minutes belong to.
 * A running AI segment is closed into segmentAiMinutes. actualMinutes waits
 * for stop, same as the human part of the run.
 */
export function buildActorToggleUpdate(task: ActorClock, nowMs: number): Partial<Task> {
    const current = workActorOf(task);
    const next: WorkActor = current === 'ai' ? 'human' : 'ai';
    const update: Partial<Task> = { workActor: next };

    if (task.status === 'in_progress' && typeof task.startedAt === 'number') {
        const since = typeof task.actorSince === 'number' ? task.actorSince : task.startedAt;
        if (current === 'ai') {
            const segment = Math.max(0, Math.round((nowMs - since) / 60000));
            if (segment > 0) {
                update.segmentAiMinutes = wholeMinutes(task.segmentAiMinutes) + segment;
            }
        }
        update.actorSince = nowMs;
        return update;
    }

    update.actorSince = undefined;
    return update;
}

/**
 * Fold the current run into logged minutes.
 * `elapsedMinutes` is the same number the caller adds to actualMinutes,
 * including the timeline's one-minute minimum.
 */
export function closedRunFields(
    task: ActorClock,
    nowMs: number,
    elapsedMinutes: number
): Pick<Task, 'aiMinutes' | 'segmentAiMinutes' | 'actorSince'> {
    const previousActual = wholeMinutes(task.actualMinutes);
    const previousAi = wholeMinutes(task.aiMinutes);
    const pending = wholeMinutes(task.segmentAiMinutes);
    const elapsed = wholeMinutes(elapsedMinutes);
    const nextActual = previousActual + elapsed;

    let added = pending;
    if (task.workActor === 'ai' && typeof task.startedAt === 'number') {
        const since = typeof task.actorSince === 'number' ? task.actorSince : task.startedAt;
        const entireRunIsAi = since <= task.startedAt && pending === 0;
        const open = entireRunIsAi ? elapsed : Math.max(0, Math.round((nowMs - since) / 60000));
        added += open;
    }
    added = Math.min(elapsed, added);

    return {
        aiMinutes: Math.min(nextActual, previousAi + added),
        segmentAiMinutes: 0,
        actorSince: undefined,
    };
}

function clampStoredAi(ai: number, actual: number, inProgress: boolean): number {
    const safe = wholeMinutes(ai);
    if (inProgress) return safe;
    return Math.min(safe, wholeMinutes(actual));
}

/**
 * What the task editor should store for the handoff.
 * Editing the recorded interval replaces the open run, so its pending AI
 * segment is dropped. A checkbox flip on a live timer closes that segment.
 */
export function buildEditorWorkUpdate(input: {
    task: ActorClock | null;
    nowMs: number;
    nextActor: WorkActor;
    aiMinutesInput: number;
    aiFieldDirty: boolean;
    /** Set when the actual start/end fields changed. Null leaves the timer alone. */
    recorded: Partial<Task> | null;
}): Partial<Task> {
    const current = workActorOf(input.task);
    const recorded = input.recorded;
    const liveFlip = !recorded
        && input.task?.status === 'in_progress'
        && typeof input.task.startedAt === 'number'
        && input.nextActor !== current;

    if (liveFlip && input.task) {
        const toggled = buildActorToggleUpdate({ ...input.task, workActor: current }, input.nowMs);
        if (input.aiFieldDirty) {
            toggled.aiMinutes = clampStoredAi(input.aiMinutesInput, input.task.actualMinutes ?? 0, true);
        }
        return toggled;
    }

    const status = recorded?.status ?? input.task?.status;
    const actual = recorded?.actualMinutes ?? input.task?.actualMinutes ?? 0;
    const patch: Partial<Task> = { workActor: input.nextActor };

    if (recorded && status === 'open') {
        return { ...patch, aiMinutes: 0, segmentAiMinutes: 0, actorSince: undefined };
    }

    if (recorded && status === 'in_progress' && typeof recorded.startedAt === 'number') {
        patch.actorSince = recorded.startedAt;
        patch.segmentAiMinutes = 0;
    }

    if (recorded && status === 'done') {
        patch.segmentAiMinutes = 0;
        patch.actorSince = undefined;
    }

    if (input.aiFieldDirty || recorded) {
        patch.aiMinutes = clampStoredAi(input.aiMinutesInput, actual, status === 'in_progress');
    }

    return patch;
}
