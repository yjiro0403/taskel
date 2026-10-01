import { createClient } from '@/lib/supabase/client';
import { readGoogleCalendarProviderToken } from '@/lib/calendarService';
import { GOOGLE_CALENDAR_WRITE_SCOPES } from '@/lib/schedule/constants';
import type { EditableCandidateInput, ScheduleIntakeView, ScheduleSettings } from '@/lib/schedule/types';

const PENDING_REGISTER_KEY = 'taskel_schedule_pending_register';

export interface PendingRegister {
    intakeId: string;
    candidate: EditableCandidateInput;
    calendarId: string;
}

async function errorCode(response: Response): Promise<string> {
    try {
        const body = await response.json() as { error?: string };
        return body.error || `http_${response.status}`;
    } catch {
        return `http_${response.status}`;
    }
}

export async function currentGoogleAccessToken(userId: string): Promise<string | null> {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    return readGoogleCalendarProviderToken(data.session?.provider_token, userId);
}

export function authHeaders(token: string | null): HeadersInit {
    return token ? { 'x-google-access-token': token } : {};
}

export async function submitIntake(form: FormData, token: string | null): Promise<{
    intake: ScheduleIntakeView;
    reused: boolean;
}> {
    const response = await fetch('/api/schedule/intake', {
        method: 'POST',
        headers: authHeaders(token),
        body: form,
    });
    if (!response.ok) {
        throw new Error(await errorCode(response));
    }
    return response.json() as Promise<{ intake: ScheduleIntakeView; reused: boolean }>;
}

export async function fetchInbox(): Promise<{ intakes: ScheduleIntakeView[]; settings: ScheduleSettings }> {
    const response = await fetch('/api/schedule/intake');
    if (!response.ok) {
        throw new Error(await errorCode(response));
    }
    return response.json() as Promise<{ intakes: ScheduleIntakeView[]; settings: ScheduleSettings }>;
}

export async function fetchScheduleSettings(): Promise<{
    settings: ScheduleSettings;
    billingAcknowledged: boolean;
}> {
    const response = await fetch('/api/schedule/settings');
    if (!response.ok) {
        throw new Error(await errorCode(response));
    }
    return response.json() as Promise<{ settings: ScheduleSettings; billingAcknowledged: boolean }>;
}

export async function saveScheduleSettingsRequest(settings: ScheduleSettings): Promise<ScheduleSettings> {
    const response = await fetch('/api/schedule/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
    });
    if (!response.ok) {
        throw new Error(await errorCode(response));
    }
    const body = await response.json() as { settings: ScheduleSettings };
    return body.settings;
}

export async function registerIntakeRequest(
    intakeId: string,
    candidate: EditableCandidateInput,
    calendarId: string,
    token: string | null,
): Promise<ScheduleIntakeView> {
    const response = await fetch(`/api/schedule/intake/${intakeId}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ ...candidate, calendarId }),
    });
    if (!response.ok) {
        throw new Error(await errorCode(response));
    }
    const body = await response.json() as { intake: ScheduleIntakeView };
    return body.intake;
}

export async function cancelIntakeRequest(intakeId: string, token: string | null): Promise<ScheduleIntakeView> {
    const response = await fetch(`/api/schedule/intake/${intakeId}/cancel`, {
        method: 'POST',
        headers: authHeaders(token),
    });
    if (!response.ok) {
        throw new Error(await errorCode(response));
    }
    const body = await response.json() as { intake: ScheduleIntakeView };
    return body.intake;
}

export async function retryIntakeRequest(intakeId: string, token: string | null): Promise<ScheduleIntakeView> {
    const response = await fetch(`/api/schedule/intake/${intakeId}/extract`, {
        method: 'POST',
        headers: authHeaders(token),
    });
    if (!response.ok) {
        throw new Error(await errorCode(response));
    }
    const body = await response.json() as { intake: ScheduleIntakeView };
    return body.intake;
}

export async function deleteIntakeRequest(intakeId: string): Promise<void> {
    const response = await fetch(`/api/schedule/intake/${intakeId}`, { method: 'DELETE' });
    if (!response.ok) {
        throw new Error(await errorCode(response));
    }
}

export function savePendingRegister(pending: PendingRegister): void {
    sessionStorage.setItem(PENDING_REGISTER_KEY, JSON.stringify(pending));
}

export function readPendingRegister(): PendingRegister | null {
    try {
        const raw = sessionStorage.getItem(PENDING_REGISTER_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PendingRegister;
        if (!parsed?.intakeId || !parsed.candidate) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function clearPendingRegister(): void {
    sessionStorage.removeItem(PENDING_REGISTER_KEY);
}

export async function connectGoogleCalendarWrite(): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${window.location.origin}/auth/callback?next=/intake`,
            scopes: GOOGLE_CALENDAR_WRITE_SCOPES,
            queryParams: {
                access_type: 'offline',
                prompt: 'consent',
            },
        },
    });
    if (error) {
        throw error;
    }
}
