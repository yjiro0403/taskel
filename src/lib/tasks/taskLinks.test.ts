import { describe, expect, it } from 'vitest';

import {
    TASK_LINK_DATE_QUERY_PARAM,
    TASK_LINK_QUERY_PARAM,
    buildTaskSharePath,
    buildTaskShareUrl,
    buildTasksPath,
    getLocalePrefixFromPathname,
    parseTaskDateFromQuery,
    parseTaskIdFromQuery,
    stripTaskQueryParam,
} from './taskLinks';

describe('taskLinks', () => {
    it('builds locale-aware tasks paths', () => {
        expect(buildTasksPath('')).toBe('/tasks');
        expect(buildTasksPath('/ja')).toBe('/ja/tasks');
        expect(buildTasksPath('/en')).toBe('/en/tasks');
    });

    it('builds share paths with the task query param', () => {
        expect(buildTaskSharePath('abc-123', '/ja')).toBe('/ja/tasks?task=abc-123');
        expect(buildTaskSharePath('id with space', '/en')).toBe(
            `/en/tasks?${TASK_LINK_QUERY_PARAM}=id+with+space`
        );
        expect(buildTaskSharePath('virtual-id', '/ja', '2026-07-27')).toBe(
            `/ja/tasks?task=virtual-id&${TASK_LINK_DATE_QUERY_PARAM}=2026-07-27`
        );
        expect(buildTaskSharePath('virtual-id', '/ja', '2026-02-30')).toBe(
            '/ja/tasks?task=virtual-id'
        );
    });

    it('builds absolute share URLs and trims trailing slash on origin', () => {
        expect(buildTaskShareUrl('https://taskel.vercel.app/', 't1', '/ja')).toBe(
            'https://taskel.vercel.app/ja/tasks?task=t1'
        );
        expect(buildTaskShareUrl('http://localhost:3000', 't2', '')).toBe(
            'http://localhost:3000/tasks?task=t2'
        );
        expect(
            buildTaskShareUrl(
                'https://taskel.vercel.app',
                'virtual-id',
                '/ja',
                '2026-07-27'
            )
        ).toBe(
            'https://taskel.vercel.app/ja/tasks?task=virtual-id&taskDate=2026-07-27'
        );
    });

    it('parses task ids from query strings and URLSearchParams', () => {
        expect(parseTaskIdFromQuery('?task=hello')).toBe('hello');
        expect(parseTaskIdFromQuery('task=hello&x=1')).toBe('hello');
        expect(parseTaskIdFromQuery(new URLSearchParams('task=from-params'))).toBe(
            'from-params'
        );
        expect(parseTaskIdFromQuery({ get: () => '  spaced  ' })).toBe('spaced');
        expect(parseTaskIdFromQuery('?foo=bar')).toBeNull();
        expect(parseTaskIdFromQuery('?task=')).toBeNull();
        expect(parseTaskIdFromQuery('?task=%20')).toBeNull();
    });

    it('parses only valid virtual occurrence dates', () => {
        expect(parseTaskDateFromQuery('?task=x&taskDate=2026-07-27')).toBe('2026-07-27');
        expect(parseTaskDateFromQuery('taskDate=%202026-01-02%20')).toBe('2026-01-02');
        expect(parseTaskDateFromQuery('?taskDate=2026-02-30')).toBeNull();
        expect(parseTaskDateFromQuery('?taskDate=not-a-date')).toBeNull();
        expect(parseTaskDateFromQuery('?task=x')).toBeNull();
    });

    it('strips the task link params while preserving unrelated params', () => {
        expect(stripTaskQueryParam('/ja/tasks', '?task=abc')).toBe('/ja/tasks');
        expect(stripTaskQueryParam('/ja/tasks', 'task=abc&foo=1')).toBe('/ja/tasks?foo=1');
        expect(stripTaskQueryParam('/en/tasks', '?foo=1&task=x&taskDate=2026-07-27&bar=2')).toBe(
            '/en/tasks?foo=1&bar=2'
        );
    });

    it('extracts locale prefixes from pathnames', () => {
        expect(getLocalePrefixFromPathname('/ja/tasks')).toBe('/ja');
        expect(getLocalePrefixFromPathname('/en/weekly')).toBe('/en');
        expect(getLocalePrefixFromPathname('/tasks')).toBe('');
        expect(getLocalePrefixFromPathname('/japanese/tasks')).toBe('');
    });
});
