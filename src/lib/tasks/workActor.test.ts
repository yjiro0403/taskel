import { describe, expect, it } from 'vitest';

import {
    buildActorToggleUpdate,
    buildEditorWorkUpdate,
    closedRunFields,
    splitLoggedMinutes,
} from './workActor';

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 6, h, m, s).getTime();

describe('splitLoggedMinutes', () => {
    it('keeps AI minutes inside the logged total', () => {
        expect(splitLoggedMinutes({ actualMinutes: 120, aiMinutes: 100 })).toEqual({ human: 20, ai: 100, total: 120 });
        expect(splitLoggedMinutes({ actualMinutes: 20, aiMinutes: 100 })).toEqual({ human: 0, ai: 20, total: 20 });
        expect(splitLoggedMinutes({ actualMinutes: 15 })).toEqual({ human: 15, ai: 0, total: 15 });
    });
});

describe('buildActorToggleUpdate', () => {
    it('arms the next run when the timer is stopped', () => {
        expect(buildActorToggleUpdate({ status: 'open', workActor: 'human' }, at(10, 0))).toEqual({
            workActor: 'ai',
            actorSince: undefined,
        });
    });

    it('closes a running AI segment without touching actual minutes', () => {
        const update = buildActorToggleUpdate({
            status: 'in_progress',
            workActor: 'ai',
            startedAt: at(9, 0),
            actorSince: at(9, 20),
            segmentAiMinutes: 0,
            actualMinutes: 0,
        }, at(11, 0));
        expect(update).toEqual({
            workActor: 'human',
            segmentAiMinutes: 100,
            actorSince: at(11, 0),
        });
    });

    it('does not add human time when handing the rest of a run to AI', () => {
        const update = buildActorToggleUpdate({
            status: 'in_progress',
            workActor: 'human',
            startedAt: at(9, 0),
            actorSince: at(9, 0),
        }, at(9, 20));
        expect(update.workActor).toBe('ai');
        expect(update.segmentAiMinutes).toBeUndefined();
        expect(update.actorSince).toBe(at(9, 20));
    });
});

describe('closedRunFields', () => {
    it('attributes a 20 minute briefing and a 100 minute AI run', () => {
        const running = {
            status: 'in_progress' as const,
            actualMinutes: 0,
            aiMinutes: 0,
            segmentAiMinutes: 0,
            workActor: 'ai' as const,
            startedAt: at(9, 0),
            actorSince: at(9, 20),
        };
        expect(closedRunFields(running, at(11, 0), 120)).toEqual({
            aiMinutes: 100,
            segmentAiMinutes: 0,
            actorSince: undefined,
        });
    });

    it('keeps a segment that was closed when AI handed the task back', () => {
        expect(closedRunFields({
            status: 'in_progress',
            actualMinutes: 0,
            aiMinutes: 0,
            segmentAiMinutes: 100,
            workActor: 'human',
            startedAt: at(9, 0),
            actorSince: at(10, 40),
        }, at(11, 0), 120)).toMatchObject({ aiMinutes: 100 });
    });

    it('counts a short all-AI run as AI, including the one-minute minimum', () => {
        expect(closedRunFields({
            status: 'in_progress',
            actualMinutes: 10,
            aiMinutes: 4,
            workActor: 'ai',
            startedAt: at(7, 3, 5),
            actorSince: at(7, 3, 5),
        }, at(7, 3, 25), 1)).toMatchObject({ aiMinutes: 5, segmentAiMinutes: 0 });
    });

    it('does not let rounded segments exceed the elapsed run', () => {
        expect(closedRunFields({
            status: 'in_progress',
            actualMinutes: 0,
            segmentAiMinutes: 30,
            workActor: 'ai',
            startedAt: at(9, 0),
            actorSince: at(9, 30),
        }, at(9, 50), 50).aiMinutes).toBe(50);
    });
});

describe('buildEditorWorkUpdate', () => {
    it('closes the live segment when the checkbox flips during a run', () => {
        const update = buildEditorWorkUpdate({
            task: {
                status: 'in_progress',
                workActor: 'human',
                startedAt: at(9, 0),
                actorSince: at(9, 0),
                actualMinutes: 0,
                aiMinutes: 0,
            },
            nowMs: at(9, 20),
            nextActor: 'ai',
            aiMinutesInput: 0,
            aiFieldDirty: false,
            recorded: null,
        });
        expect(update.workActor).toBe('ai');
        expect(update.actorSince).toBe(at(9, 20));
    });

    it('clamps a corrected AI total to the edited actual minutes', () => {
        expect(buildEditorWorkUpdate({
            task: { status: 'done', actualMinutes: 120, aiMinutes: 100, workActor: 'ai' },
            nowMs: at(12, 0),
            nextActor: 'ai',
            aiMinutesInput: 100,
            aiFieldDirty: false,
            recorded: { status: 'done', actualMinutes: 30 },
        })).toMatchObject({ aiMinutes: 30, segmentAiMinutes: 0, workActor: 'ai' });
    });

    it('drops AI minutes when the recorded run is cleared', () => {
        expect(buildEditorWorkUpdate({
            task: { status: 'done', actualMinutes: 120, aiMinutes: 100, workActor: 'ai' },
            nowMs: at(12, 0),
            nextActor: 'human',
            aiMinutesInput: 100,
            aiFieldDirty: false,
            recorded: { status: 'open', actualMinutes: 0 },
        })).toEqual({
            workActor: 'human',
            aiMinutes: 0,
            segmentAiMinutes: 0,
            actorSince: undefined,
        });
    });
});
