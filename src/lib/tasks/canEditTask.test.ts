import { describe, expect, it } from 'vitest';

import { canEditTask, type ProjectLikeForEditAuth } from './canEditTask';

const projects: ProjectLikeForEditAuth[] = [
    {
        id: 'proj-owned',
        ownerId: 'user-owner',
        roles: {
            'user-owner': 'owner',
            'user-admin': 'admin',
            'user-member': 'member',
            'user-viewer': 'viewer',
        },
    },
    {
        id: 'proj-no-roles',
        ownerId: 'user-owner',
        // roles omitted → non-owners default to 'member'
    },
];

describe('canEditTask', () => {
    it('denies edit when there is no authenticated user', () => {
        expect(canEditTask({ projectId: undefined }, null, projects)).toBe(false);
        expect(canEditTask({ projectId: undefined }, undefined, projects)).toBe(false);
        expect(canEditTask({ projectId: 'proj-owned' }, '', projects)).toBe(false);
    });

    it('allows edit for personal (no project) tasks when signed in', () => {
        expect(canEditTask({ projectId: undefined }, 'anyone', projects)).toBe(true);
        expect(canEditTask({ projectId: null }, 'anyone', projects)).toBe(true);
        expect(canEditTask({ projectId: '' }, 'anyone', projects)).toBe(true);
    });

    it('denies edit when the project is not in the loaded list', () => {
        expect(canEditTask({ projectId: 'missing-proj' }, 'user-owner', projects)).toBe(false);
    });

    it('allows the project owner even if roles map is incomplete', () => {
        expect(canEditTask({ projectId: 'proj-owned' }, 'user-owner', projects)).toBe(true);
        expect(canEditTask({ projectId: 'proj-no-roles' }, 'user-owner', projects)).toBe(true);
    });

    it('allows admin and member roles', () => {
        expect(canEditTask({ projectId: 'proj-owned' }, 'user-admin', projects)).toBe(true);
        expect(canEditTask({ projectId: 'proj-owned' }, 'user-member', projects)).toBe(true);
    });

    it('denies the viewer role (same as TaskItem canEdit=false)', () => {
        expect(canEditTask({ projectId: 'proj-owned' }, 'user-viewer', projects)).toBe(false);
    });

    it('defaults missing role entries to member (editable)', () => {
        expect(canEditTask({ projectId: 'proj-owned' }, 'user-unknown', projects)).toBe(true);
        expect(canEditTask({ projectId: 'proj-no-roles' }, 'user-other', projects)).toBe(true);
    });
});
