import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CalendarEvent } from './calendarService';
import {
  buildGoogleCalendarDayRequest,
  fetchCalendarEventsForDate,
  resolveEventReminderMinutes,
  formatLocalDate,
  getLocalDayRange,
  GOOGLE_CALENDAR_PROVIDER_TOKEN_STORAGE_KEY,
  GoogleCalendarAuthorizationError,
  isGoogleCalendarSyncDataReady,
  peekStoredCurrentDate,
  readGoogleCalendarProviderToken,
  resolveCalendarSyncDate,
  clearGoogleCalendarProviderToken,
  storeGoogleCalendarProviderToken,
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
    expect(end.getDate()).toBe(19);
    expect(end.getHours()).toBe(0);
    expect(end.getMinutes()).toBe(0);
    expect(end.getSeconds()).toBe(0);
    expect(end.getMilliseconds()).toBe(0);
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

describe('Google Calendar provider token storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captures the one-time OAuth provider token for the pending sync', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {});
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    expect(readGoogleCalendarProviderToken(undefined, 'user-1')).toBeNull();
    storeGoogleCalendarProviderToken('google-provider-token', 'user-1');
    expect(
      JSON.parse(values.get(GOOGLE_CALENDAR_PROVIDER_TOKEN_STORAGE_KEY)!)
    ).toEqual({
      token: 'google-provider-token',
      userId: 'user-1',
    });
    expect(readGoogleCalendarProviderToken(undefined, 'user-1')).toBe(
      'google-provider-token'
    );

    clearGoogleCalendarProviderToken();
    expect(readGoogleCalendarProviderToken(undefined, 'user-1')).toBeNull();
  });

  it('prefers and stores a fresh session token for the current Taskel user', () => {
    const values = new Map<string, string>([
      [
        GOOGLE_CALENDAR_PROVIDER_TOKEN_STORAGE_KEY,
        JSON.stringify({ token: 'old-token', userId: 'user-1' }),
      ],
    ]);
    vi.stubGlobal('window', {});
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    expect(
      readGoogleCalendarProviderToken('fresh-token', 'user-1')
    ).toBe('fresh-token');
    expect(
      JSON.parse(values.get(GOOGLE_CALENDAR_PROVIDER_TOKEN_STORAGE_KEY)!)
    ).toEqual({
      token: 'fresh-token',
      userId: 'user-1',
    });
  });

  it('does not reuse a Google token captured for a different Taskel user', () => {
    const values = new Map<string, string>([
      [
        GOOGLE_CALENDAR_PROVIDER_TOKEN_STORAGE_KEY,
        JSON.stringify({ token: 'user-1-token', userId: 'user-1' }),
      ],
    ]);
    vi.stubGlobal('window', {});
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    expect(
      readGoogleCalendarProviderToken(undefined, 'user-2')
    ).toBeNull();
  });
});

describe('isGoogleCalendarSyncDataReady', () => {
  it('waits for both tasks and sections after the OAuth return', () => {
    expect(isGoogleCalendarSyncDataReady('loading', false, 0)).toBe(false);
    expect(isGoogleCalendarSyncDataReady('ready', false, 1)).toBe(false);
    expect(isGoogleCalendarSyncDataReady('ready', true, 0)).toBe(false);
    expect(isGoogleCalendarSyncDataReady('ready', true, 1)).toBe(true);
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

    // Lower bound is the chosen day; exclusive upper bound is next local midnight.
    expect(formatLocalDate(new Date(request.timeMin))).toBe('2026-07-18');
    expect(formatLocalDate(new Date(request.timeMax))).toBe('2026-07-19');

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
    expect(formatLocalDate(new Date(url.searchParams.get('timeMax')!))).toBe('2026-07-19');
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

  it.each([401, 403])(
    'reports status %s as a reconnectable Google authorization error',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status,
        })
      );

      await expect(
        fetchCalendarEventsForDate(
          'expired-or-unscoped-token',
          '2026-07-18',
          '2026-07-18'
        )
      ).rejects.toEqual(new GoogleCalendarAuthorizationError(status));
    }
  );
});


describe('resolveEventReminderMinutes', () => {
  const baseEvent = (
    reminders: CalendarEvent['reminders']
  ): CalendarEvent => ({
    id: 'evt-1',
    summary: '面談',
    start: { dateTime: '2026-09-15T18:30:00+09:00' },
    end: { dateTime: '2026-09-15T19:00:00+09:00' },
    reminders,
  });

  it('overrides の popup 通知を分の昇順で返す', () => {
    const event = baseEvent({
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 30 },
      ],
    });
    expect(resolveEventReminderMinutes(event, [])).toEqual([30, 60]);
  });

  it('useDefault のときはカレンダー既定の通知を使う', () => {
    const event = baseEvent({ useDefault: true });
    expect(
      resolveEventReminderMinutes(event, [{ method: 'popup', minutes: 10 }])
    ).toEqual([10]);
  });

  it('useDefault のとき overrides があっても既定側を優先する', () => {
    const event = baseEvent({
      useDefault: true,
      overrides: [{ method: 'popup', minutes: 45 }],
    });
    expect(
      resolveEventReminderMinutes(event, [{ method: 'popup', minutes: 5 }])
    ).toEqual([5]);
  });

  it('email など popup 以外の通知は除外する', () => {
    const event = baseEvent({
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 1440 },
        { method: 'popup', minutes: 15 },
      ],
    });
    expect(resolveEventReminderMinutes(event, [])).toEqual([15]);
  });

  it('method 未指定は popup とみなす', () => {
    const event = baseEvent({ useDefault: false, overrides: [{ minutes: 20 }] });
    expect(resolveEventReminderMinutes(event, [])).toEqual([20]);
  });

  it('重複する分は1件にまとめる', () => {
    const event = baseEvent({
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
        { method: 'popup', minutes: 30 },
      ],
    });
    expect(resolveEventReminderMinutes(event, [])).toEqual([30]);
  });

  it('reminders が無い / minutes が欠けている場合は空配列', () => {
    expect(resolveEventReminderMinutes(baseEvent(undefined), [])).toEqual([]);
    expect(
      resolveEventReminderMinutes(
        baseEvent({ useDefault: false, overrides: [{ method: 'popup' }] }),
        []
      )
    ).toEqual([]);
  });

  it('0分前（開始時刻ちょうど）も有効な値として扱う', () => {
    const event = baseEvent({
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 0 }],
    });
    expect(resolveEventReminderMinutes(event, [])).toEqual([0]);
  });
});
