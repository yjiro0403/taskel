import { format } from 'date-fns';

interface CalendarEvent {
    id: string;
    summary: string;
    htmlLink?: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
}

export async function fetchCalendarEvents(accessToken: string, timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
    });

    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch calendar events');
    }

    const data = await response.json();
    return data.items || [];
}
