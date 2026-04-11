import { describe, expect, it } from 'vitest';

import { mapProject, mapSection, mapTag, mapTask } from './mappers';
import type { Database } from '../../types/supabase';

type Tables = Database['public']['Tables'];

describe('supabase mappers', () => {
  it('maps section snake_case fields to camelCase', () => {
    const row: Tables['sections']['Row'] = {
      id: 'section-1',
      user_id: 'user-1',
      name: 'Morning',
      start_time: '06:00',
      end_time: '12:00',
      order: 0,
    };

    expect(mapSection(row)).toEqual({
      id: 'section-1',
      userId: 'user-1',
      name: 'Morning',
      startTime: '06:00',
      endTime: '12:00',
      order: 0,
    });
  });

  it('maps nullable task fields and tag rows', () => {
    const taskRow: Tables['tasks']['Row'] = {
      id: 'task-1',
      user_id: 'user-1',
      title: 'Write tests',
      assignee_id: null,
      reporter_id: 'user-2',
      section_id: 'section-1',
      date: '2026-04-11',
      status: 'open',
      estimated_minutes: 30,
      actual_minutes: 0,
      started_at: null,
      completed_at: null,
      scheduled_start: '09:30',
      external_link: null,
      parent_goal_id: null,
      ai_tags: ['focus'],
      project_id: null,
      milestone_id: null,
      routine_id: null,
      assigned_week: null,
      assigned_month: null,
      assigned_year: null,
      assigned_date: null,
      score: null,
      order: 3,
      memo: null,
      created_at: '2026-04-11T01:00:00.000Z',
      updated_at: '2026-04-11T02:00:00.000Z',
      ai_status: null,
      ai_error: null,
      ai_completed_at: null,
      comment_count: 2,
    };
    const tagRows: Tables['tags']['Row'][] = [
      {
        id: 'tag-1',
        user_id: 'user-1',
        name: 'backend',
        memo: null,
        color: '#000000',
        created_at: '2026-04-11T00:00:00.000Z',
        updated_at: '2026-04-11T00:00:00.000Z',
      },
    ];

    expect(mapTask(taskRow, tagRows.map(mapTag))).toMatchObject({
      id: 'task-1',
      userId: 'user-1',
      reporterId: 'user-2',
      scheduledStart: '09:30',
      aiTags: ['focus'],
      tags: ['backend'],
      commentCount: 2,
    });
    expect(mapTask(taskRow, tagRows.map(mapTag)).assigneeId).toBeUndefined();
    expect(mapTask(taskRow, tagRows.map(mapTag)).createdAt).toBe(new Date(taskRow.created_at).getTime());
  });

  it('includes owner and deduplicated member ids in mapped projects', () => {
    const projectRow: Tables['projects']['Row'] = {
      id: 'project-1',
      owner_id: 'owner-1',
      title: 'Migration',
      description: 'Ship it',
      status: 'active',
      created_at: '2026-04-10T00:00:00.000Z',
      updated_at: '2026-04-11T00:00:00.000Z',
    };
    const memberRows: Tables['project_members']['Row'][] = [
      {
        project_id: 'project-1',
        user_id: 'owner-1',
        role: 'owner',
        created_at: '2026-04-10T00:00:00.000Z',
      },
      {
        project_id: 'project-1',
        user_id: 'member-1',
        role: 'member',
        created_at: '2026-04-10T00:00:00.000Z',
      },
    ];

    expect(mapProject(projectRow, memberRows)).toMatchObject({
      userId: 'owner-1',
      memberIds: ['owner-1', 'member-1'],
      roles: {
        'owner-1': 'owner',
        'member-1': 'member',
      },
    });
  });
});
