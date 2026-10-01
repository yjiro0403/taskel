import type { Attachment, ChecklistItem, Section, Task } from '@/types';
import { getSectionForTime } from '@/lib/sectionUtils';

export type TaskFormType = 'task' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface TaskFormSeed {
    targetTask?: Task | null;
    defaultSectionId?: string;
    initialProjectId?: string;
    initialMilestoneId?: string;
    initialDate?: string;
    initialAssignedWeek?: string;
    initialAssignedMonth?: string;
    initialAssignedYear?: string;
    initialAssignedDate?: string;
    sections: Section[];
    currentDate: string;
}

export interface TaskFormState {
    activeType: TaskFormType;
    title: string;
    score: number | string;
    estimatedMinutes: number | string;
    actualMinutes: number | string;
    sectionId: string;
    projectId: string;
    milestoneId: string;
    scheduledStart: string;
    date: string;
    assignedDate: string;
    assignedWeek: string;
    assignedMonth: string;
    assignedYear: string;
    memo: string;
    tags: string[];
    checklist: ChecklistItem[];
    attachments: Attachment[];
    taskelAIEnabled: boolean;
}

export function resolveTaskFormType(
    seed: Pick<
        TaskFormSeed,
        'targetTask' | 'initialAssignedDate' | 'initialAssignedWeek' | 'initialAssignedMonth' | 'initialAssignedYear'
    >
): TaskFormType {
    const targetTask = seed.targetTask;
    if (targetTask?.assignedDate || seed.initialAssignedDate) return 'daily';
    if (targetTask?.assignedWeek || seed.initialAssignedWeek) return 'weekly';
    if (targetTask?.assignedMonth || seed.initialAssignedMonth) return 'monthly';
    if (targetTask?.assignedYear || seed.initialAssignedYear) return 'yearly';
    return 'task';
}

/** Values applied when the edit/add form opens. Later store updates must not rebuild these. */
export function buildTaskFormState(seed: TaskFormSeed): TaskFormState {
    const targetTask = seed.targetTask ?? null;
    const activeType = resolveTaskFormType({ ...seed, targetTask });

    let sectionId = targetTask?.sectionId || seed.defaultSectionId || seed.sections[0]?.id || '';
    const scheduledStart = targetTask?.scheduledStart || '';
    if (scheduledStart.length === 5) {
        const correctSection = getSectionForTime(seed.sections, scheduledStart);
        if (correctSection !== sectionId) {
            sectionId = correctSection;
        }
    }

    return {
        activeType,
        title: targetTask?.title || '',
        score: targetTask?.score !== undefined ? targetTask.score : '',
        estimatedMinutes: targetTask?.estimatedMinutes !== undefined ? targetTask.estimatedMinutes : 15,
        actualMinutes: targetTask?.actualMinutes !== undefined ? targetTask.actualMinutes : 0,
        sectionId,
        projectId: targetTask?.projectId || seed.initialProjectId || '',
        milestoneId: targetTask?.milestoneId || seed.initialMilestoneId || '',
        scheduledStart,
        date: targetTask
            ? (targetTask.date || '')
            : seed.initialDate !== undefined
                ? seed.initialDate
                : activeType === 'task'
                    ? seed.currentDate
                    : '',
        assignedDate: targetTask?.assignedDate || seed.initialAssignedDate || (activeType === 'daily' ? seed.currentDate : ''),
        assignedWeek: targetTask?.assignedWeek || seed.initialAssignedWeek || '',
        assignedMonth: targetTask?.assignedMonth || seed.initialAssignedMonth || '',
        assignedYear: targetTask?.assignedYear || seed.initialAssignedYear || '',
        memo: targetTask?.memo || '',
        tags: targetTask?.tags ? [...targetTask.tags] : [],
        checklist: targetTask?.checklist ? targetTask.checklist.map((item) => ({ ...item })) : [],
        attachments: targetTask?.attachments ? targetTask.attachments.map((item) => ({ ...item })) : [],
        taskelAIEnabled: targetTask?.aiTags?.includes('ai-workspace') ?? false,
    };
}
