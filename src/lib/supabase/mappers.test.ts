import { describe, expect, it } from 'vitest';

import { mapItemTemplate, mapProject, mapSection, mapTag, mapTask, parseChecklist, parseTemplateItems } from './mappers';
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
      checklist: [{ id: 'item-1', name: '充電器', checked: true }],
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
      checklist: [{ id: 'item-1', name: '充電器', checked: true }],
    });
    expect(mapTask(taskRow, tagRows.map(mapTag)).assigneeId).toBeUndefined();
    expect(mapTask(taskRow, tagRows.map(mapTag)).createdAt).toBe(new Date(taskRow.created_at).getTime());
  });

  it('parses checklist jsonb defensively', () => {
    // 正常系: 配列順を保ち、checked は真偽値に正規化される
    expect(
      parseChecklist([
        { id: 'a', name: 'ノートPC', checked: true },
        { id: 'b', name: '名刺', checked: false },
      ])
    ).toEqual([
      { id: 'a', name: 'ノートPC', checked: true },
      { id: 'b', name: '名刺', checked: false },
    ]);

    // 異常系: 非配列・型崩れ要素・空文字 name は落とす
    expect(parseChecklist(null)).toEqual([]);
    expect(parseChecklist('broken')).toEqual([]);
    expect(parseChecklist({ name: 'x' })).toEqual([]);
    expect(
      parseChecklist([
        'just-a-string',
        42,
        null,
        ['nested'],
        { id: 'c', name: '', checked: true },
        { id: 'd', name: '   ', checked: true },
        { id: 'e', name: '有効な項目', checked: 'yes' },
      ])
    ).toEqual([{ id: 'e', name: '有効な項目', checked: false }]);

    // id 欠落・非文字列 id は新しい id を採番して救済する
    const rescued = parseChecklist([{ name: '傘', checked: true }, { id: 7, name: '鍵', checked: false }]);
    expect(rescued).toHaveLength(2);
    expect(rescued[0]).toMatchObject({ name: '傘', checked: true });
    expect(rescued[0].id).toBeTruthy();
    expect(rescued[1]).toMatchObject({ name: '鍵', checked: false });
    expect(typeof rescued[1].id).toBe('string');
  });

  it('parses template items jsonb defensively', () => {
    expect(parseTemplateItems(['充電器', 'ノートPC'])).toEqual(['充電器', 'ノートPC']);
    expect(parseTemplateItems(null)).toEqual([]);
    expect(parseTemplateItems('broken')).toEqual([]);
    expect(parseTemplateItems(['有効', '', '   ', 42, null, { name: 'x' }])).toEqual(['有効']);
  });

  it('maps item template rows to camelCase', () => {
    const row = {
      id: 'template-1',
      user_id: 'user-1',
      name: '現場セット',
      items: ['ヘルメット', '軍手'],
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-02T00:00:00.000Z',
    };

    expect(mapItemTemplate(row)).toEqual({
      id: 'template-1',
      userId: 'user-1',
      name: '現場セット',
      items: ['ヘルメット', '軍手'],
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    });
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
