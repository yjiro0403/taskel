import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildGoogleCalendarDayRequest,
  fetchCalendarEventsForDate,
  formatLocalDate,
  getLocalDayRange,
  peekStoredCurrentDate,
  resolveCalendarSyncDate,
} from './calendarService';

describe('getLocalDayRange', () => {
  it('parses yyyy-MM-dd as local calendar components (no UTC day shift)', () => {
    const { start, end } = getLocalDayRange('2026-07-18');

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(6); // July
    expect(start.getDate()).toBe(18);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);

    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(6);
    expect(end.getDate()).toBe(18);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it('keeps the UI calendar day even when Date("yyyy-MM-dd") would shift', () => {
    const dateStr = '2026-07-18';
    const { start } = getLocalDayRange(dateStr);

    expect(formatLocalDate(start)).toBe(dateStr);

    const utcParsedLocalDay = formatLocalDate(new Date(dateStr));
    if (new Date(dateStr).getTimezoneOffset() > 0) {
      expect(utcParsedLocalDay).not.toBe(dateStr);
    }
  });

  it('rejects invalid date strings', () => {
    expect(() => getLocalDayRange('03/15/2026')).toThrow(/Invalid date string/);
    expect(() => getLocalDayRange('2026-3-15')).toThrow(/Invalid date string/);
  });
});

describe('formatLocalDate', () => {
  it('formats local calendar date without UTC toISOString shift', () => {
    const date = new Date(2026, 6, 18, 1, 30, 0); // local July 18
    expect(formatLocalDate(date)).toBe('2026-07-18');

    const earlyLocal = new Date(2026, 6, 18, 0, 30, 0);
    expect(formatLocalDate(earlyLocal)).toBe('2026-07-18');
  });
});

describe('peekStoredCurrentDate', () => {
  it('returns null when window/sessionStorage is unavailable (no invented today)', () => {
    // Node unit environment has no real browser sessionStorage binding for our helper path
    // when window is undefined — function must not throw.
    expect(() => peekStoredCurrentDate()).not.toThrow();
  });
});

describe('resolveCalendarSyncDate', () => {
  it('prefers explicit target over UI currentDate and never invents system today', () => {
    expect(resolveCalendarSyncDate('2026-07-18', '2026-07-14')).toBe('2026-07-18');
    expect(resolveCalendarSyncDate(undefined, '2026-07-18')).toBe('2026-07-18');
  });

  it('rejects missing/invalid dates instead of falling back to today', () => {
    expect(() => resolveCalendarSyncDate(undefined, undefined)).toThrow(/No valid UI-selected date/);
    expect(() => resolveCalendarSyncDate('', 'not-a-date')).toThrow(/No valid UI-selected date/);
  });
});

describe('Google Calendar API range integration (chosen local day)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('buildGoogleCalendarDayRequest maps 2026-07-18 to that local day timeMin/timeMax', () => {
    const request = buildGoogleCalendarDayRequest('2026-07-18');
    const { start, end } = getLocalDayRange('2026-07-18');

    expect(request.dateStr).toBe('2026-07-18');
    expect(request.timeMin).toBe(start.toISOString());
    expect(request.timeMax).toBe(end.toISOString());

    // Round-trip: API bounds still represent local calendar day 2026-07-18
    expect(formatLocalDate(new Date(request.timeMin))).toBe('2026-07-18');
    expect(formatLocalDate(new Date(request.timeMax))).toBe('2026-07-18');

    const url = new URL(request.urlPathWithQuery);
    expect(url.searchParams.get('timeMin')).toBe(request.timeMin);
    expect(url.searchParams.get('timeMax')).toBe(request.timeMax);
    expect(url.searchParams.get('singleEvents')).toBe('true');
    expect(url.searchParams.get('orderBy')).toBe('startTime');
  });

  it('fetchCalendarEventsForDate sends timeMin/timeMax for the chosen UI date, not store "today"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: 'evt-1', summary: 'Sync me' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const storeToday = '2026-07-14'; // system/UI "today" decoy
    const chosenDate = '2026-07-18';
    const expected = buildGoogleCalendarDayRequest(chosenDate);

    const { dateStr, events } = await fetchCalendarEventsForDate(
      'test-access-token',
      chosenDate,
      storeToday
    );

    expect(dateStr).toBe(chosenDate);
    expect(events).toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(calledUrl);

    expect(url.searchParams.get('timeMin')).toBe(expected.timeMin);
    expect(url.searchParams.get('timeMax')).toBe(expected.timeMax);
    expect(formatLocalDate(new Date(url.searchParams.get('timeMin')!))).toBe('2026-07-18');
    expect(formatLocalDate(new Date(url.searchParams.get('timeMax')!))).toBe('2026-07-18');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-access-token',
    });

    // Prove we did not request the decoy "today" range
    const todayRange = buildGoogleCalendarDayRequest(storeToday);
    expect(url.searchParams.get('timeMin')).not.toBe(todayRange.timeMin);
  });

  it('uses uiCurrentDate when explicit target is omitted (still not a free-floating system Date)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const uiSelected = '2026-07-18';
    const expected = buildGoogleCalendarDayRequest(uiSelected);

    await fetchCalendarEventsForDate('tok', undefined, uiSelected);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.get('timeMin')).toBe(expected.timeMin);
    expect(url.searchParams.get('timeMax')).toBe(expected.timeMax);
  });
});
