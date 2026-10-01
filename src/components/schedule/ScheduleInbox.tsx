'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { Menu } from 'lucide-react';

import {
    cancelIntakeRequest,
    clearPendingRegister,
    connectGoogleCalendarWrite,
    currentGoogleAccessToken,
    deleteIntakeRequest,
    fetchInbox,
    readPendingRegister,
    registerIntakeRequest,
    retryIntakeRequest,
    savePendingRegister,
    submitIntake,
} from '@/lib/schedule/apiClient';
import { listLocalCaptures, removeLocalCapture, saveLocalCapture, type LocalCapture } from '@/lib/schedule/localInbox';
import { addMinutesToTime, resolveWallTime } from '@/lib/schedule/time';
import type { EditableCandidateInput, ReviewReason, ScheduleCandidate, ScheduleIntakeView, ScheduleSettings } from '@/lib/schedule/types';
import { useStore } from '@/store/useStore';
import type { Task } from '@/types';

const REASON_JA: Record<ReviewReason, string> = {
    multiple_items: '候補が複数あるので、登録する1件を選んでください。',
    not_confirmed: '予定が確定表現ではありません。',
    missing_title: '件名が画像または文章に明示されていません。',
    missing_year: '年が明示されていません。',
    missing_date: '年月日が揃っていません。',
    missing_start: '開始時刻が明示されていません。',
    missing_end: '終了時刻が明示されていません。',
    ambiguous_time: '時刻の読み取りに曖昧さが残っています。',
    weekday_mismatch: '曜日と日付が一致しません。',
    past_date: '開始が過去です。登録するなら内容を確認してください。',
    end_not_after_start: '終了が開始より後ではありません。',
    timezone_uncertain: 'タイムゾーンを確定できません。',
    dst_gap: '夏時間の切れ目や重なりで時刻を確定できません。',
    relative_expression: '「明日」「来週」などの相対表現は、自動では確定しません。',
    conversation_change: '日程を変更した会話で、最終確定だけを断定できません。',
    tentative: '暫定・未定の表現があります。',
    all_day: '終日予定は自動登録しません。',
    unreadable: '予定を読み取れませんでした。',
    auto_register_off: '自動登録はオフです。内容が揃っていれば、このまま登録できます。',
    google_auth_required: 'Googleカレンダーへの書き込み許可が必要です。',
    notification_time: '通知や送信時刻を予定時刻と区別できません。',
};

const ERROR_JA: Record<string, string> = {
    ai_billing_not_acknowledged: '画像と文章をAIへ送る前に、課金済みのGemini APIであることの確認がサーバー設定にありません。受信した内容は残しています。',
    ai_not_configured: 'AIのAPIキーがサーバーにありません。受信した内容は残しています。',
    quota_exceeded: '今月のAI利用上限に達しました。受信した内容は残しています。',
    extract_failed: '解析に失敗しました。登録済みにはしていません。',
    google_auth_required: 'Googleカレンダーの権限がありません。再連携してから登録できます。',
    google_write_failed: 'Googleカレンダーへの登録に失敗しました。登録済みにはしていません。',
    google_cancel_failed: 'カレンダーの予定を取り消せませんでした。予定は残っています。',
    task_create_failed: 'カレンダー側の処理のあと、Taskelのタスク作成に失敗しました。再試行すると同じ予定を重複作成しません。',
    task_kept: 'カレンダーの予定は取り消しました。Taskelのタスクは編集済みのため残しています。',
    image_store_failed: '画像の保存に失敗しました。この端末の受信データから再試行できます。',
    cancel_first: '先にカレンダーの予定を取り消してから、受信を削除できます。',
};

function textOf(code: string | null | undefined): string {
    if (!code) return '';
    return ERROR_JA[code] ?? REASON_JA[code as ReviewReason] ?? code;
}

function formFromCandidate(candidate: ScheduleCandidate | undefined, settings: ScheduleSettings): EditableCandidateInput {
    const startTime = candidate?.startTime ?? candidate?.suggestedStartTime ?? '';
    const explicitEnd = candidate?.endTime ?? candidate?.suggestedEndTime ?? '';
    const suggestedEnd = !explicitEnd && startTime && settings.defaultDurationMinutes
        ? addMinutesToTime(startTime, settings.defaultDurationMinutes) ?? ''
        : explicitEnd;
    return {
        title: candidate?.title ?? candidate?.suggestedTitle ?? '',
        date: candidate?.date ?? candidate?.suggestedDate ?? '',
        startTime,
        endTime: suggestedEnd,
        timeZone: candidate?.timeZone || 'Asia/Tokyo',
        allDay: candidate?.allDay ?? false,
    };
}

function weekdayLabel(date: string, timeZone: string): string {
    const noon = resolveWallTime(date, '12:00', timeZone);
    if (!noon.ok) return date;
    return new Intl.DateTimeFormat('ja-JP', {
        timeZone,
        weekday: 'short',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
    }).format(noon.utc);
}

function rememberTask(intake: ScheduleIntakeView) {
    const candidate = intake.candidates[0];
    if (intake.status !== 'registered' || !candidate?.title || !candidate.date || !intake.taskId) {
        return;
    }
    const task: Task = {
        id: intake.taskId,
        userId: '',
        title: candidate.title,
        sectionId: '',
        date: candidate.date,
        status: 'open',
        estimatedMinutes: 30,
        actualMinutes: 0,
        scheduledStart: candidate.allDay ? undefined : candidate.startTime ?? undefined,
        externalLink: intake.googleEventLink ?? undefined,
        order: 0,
        memo: '予定の取り込みから作成',
    };
    useStore.setState((state) => {
        if (state.tasks.some((item) => item.id === task.id)) {
            return { tasks: state.tasks.map((item) => item.id === task.id ? { ...item, ...task, userId: item.userId, sectionId: item.sectionId } : item) };
        }
        return { tasks: [...state.tasks, { ...task, userId: state.user?.uid ?? '' }] };
    });
}

function forgetTask(taskId: string | null) {
    if (!taskId) return;
    useStore.setState((state) => ({ tasks: state.tasks.filter((task) => task.id !== taskId) }));
}

export function IntakeEditor({
    intake,
    settings,
    onChange,
    onRemoved,
}: {
    intake: ScheduleIntakeView;
    settings: ScheduleSettings;
    onChange: (intake: ScheduleIntakeView) => void;
    onRemoved: (id: string) => void;
}) {
    const user = useStore((state) => state.user);
    const router = useRouter();
    const setCurrentDate = useStore((state) => state.setCurrentDate);
    const [form, setForm] = useState(() => formFromCandidate(intake.candidates[0], settings));
    const [calendarId, setCalendarId] = useState(intake.googleCalendarId || settings.calendarId || 'primary');
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        setForm(formFromCandidate(intake.candidates[0], settings));
        setCalendarId(intake.googleCalendarId || settings.calendarId || 'primary');
    }, [intake, settings]);

    const token = useCallback(async () => {
        if (!user) return null;
        return currentGoogleAccessToken(user.uid);
    }, [user]);

    const explainAuth = async (candidate: EditableCandidateInput) => {
        savePendingRegister({ intakeId: intake.id, candidate, calendarId });
        setMessage('Googleカレンダーへの登録許可を求めています。許可後、この内容で登録を再開します。');
        await connectGoogleCalendarWrite();
    };

    const register = async () => {
        setBusy('register');
        setMessage(null);
        try {
            const access = await token();
            if (!access) {
                await explainAuth(form);
                return;
            }
            const next = await registerIntakeRequest(intake.id, form, calendarId, access);
            if (next.errorCode === 'google_auth_required' || next.status === 'failed' && next.errorCode === 'google_auth_required') {
                await explainAuth(form);
            }
            onChange(next);
            if (next.status === 'registered') {
                rememberTask(next);
                setMessage(null);
            } else {
                setMessage(textOf(next.errorCode) || '登録できませんでした。登録済みにはしていません。');
            }
        } catch (error) {
            const code = error instanceof Error ? error.message : 'register_failed';
            if (code === 'google_auth_required') {
                await explainAuth(form);
            } else {
                setMessage(textOf(code));
            }
        } finally {
            setBusy(null);
        }
    };

    const cancel = async () => {
        setBusy('cancel');
        setMessage(null);
        try {
            const access = await token();
            if (!access) {
                await explainAuth(form);
                return;
            }
            const next = await cancelIntakeRequest(intake.id, access);
            onChange(next);
            if (next.status === 'cancelled' && next.errorCode !== 'task_kept') {
                forgetTask(intake.taskId);
            }
            setMessage(next.status === 'cancelled'
                ? (next.errorCode === 'task_kept' ? textOf('task_kept') : 'カレンダーの予定を取り消しました。')
                : (textOf(next.errorCode) || '取り消しに失敗しました。'));
        } catch (error) {
            setMessage(textOf(error instanceof Error ? error.message : 'google_cancel_failed'));
        } finally {
            setBusy(null);
        }
    };

    const retry = async () => {
        setBusy('retry');
        setMessage(null);
        try {
            const next = await retryIntakeRequest(intake.id, await token());
            onChange(next);
        } catch (error) {
            setMessage(textOf(error instanceof Error ? error.message : 'extract_failed'));
        } finally {
            setBusy(null);
        }
    };

    const remove = async () => {
        setBusy('delete');
        setMessage(null);
        try {
            await deleteIntakeRequest(intake.id);
            onRemoved(intake.id);
        } catch (error) {
            setMessage(textOf(error instanceof Error ? error.message : 'delete_failed'));
            setBusy(null);
        }
    };

    const registered = intake.candidates[0];
    const when = registered?.date
        ? `${weekdayLabel(registered.date, registered.timeZone)} ${registered.allDay ? '終日' : `${registered.startTime ?? ''}–${registered.endTime ?? ''}`} ${registered.timeZone}`
        : '';

    return (
        <article className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs text-gray-500">
                        {intake.source === 'text' ? 'テキスト' : intake.source === 'image_share' ? '共有画像' : '画像'}
                        {' · '}
                        {intake.status === 'registered' ? '登録済み' : intake.status === 'needs_review' ? '要確認' : intake.status === 'failed' ? '失敗' : intake.status === 'cancelled' ? '取消済み' : intake.status === 'extracting' ? '解析中' : '受信済み'}
                    </p>
                    <h2 className="font-semibold text-gray-900">{registered?.title || form.title || '無題の受信'}</h2>
                </div>
                {intake.eligibleForAuto && intake.status === 'needs_review' && (
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full">登録できる状態</span>
                )}
            </div>

            {intake.imageUrl && (
                <img src={intake.imageUrl} alt="受信した画像" className="max-h-64 rounded-lg border border-gray-100 object-contain" />
            )}
            {intake.rawText && <p className="text-sm text-gray-700 whitespace-pre-wrap">{intake.rawText}</p>}
            {intake.imageNotes && <p className="text-xs text-gray-500">解析メモ: {intake.imageNotes}</p>}

            {intake.reasons.length > 0 && (
                <ul className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3 space-y-1">
                    {intake.reasons.map((reason) => <li key={reason}>{REASON_JA[reason]}</li>)}
                </ul>
            )}
            {intake.errorCode && intake.status !== 'registered' && (
                <p className="text-sm text-red-700 bg-red-50 rounded-lg p-3">{textOf(intake.errorCode)}</p>
            )}
            {message && <p className="text-sm text-gray-700">{message}</p>}

            {intake.status === 'registered' && registered && (
                <div className="text-sm text-gray-800 space-y-1">
                    <p>{when}</p>
                    <p>登録先: {intake.googleCalendarId || settings.calendarId}</p>
                    {intake.googleEventLink && (
                        <a className="text-blue-700 underline" href={intake.googleEventLink} target="_blank" rel="noreferrer">
                            Googleカレンダーで開く
                        </a>
                    )}
                    <div className="flex flex-wrap gap-2 pt-2">
                        <button
                            type="button"
                            className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
                            onClick={() => {
                                if (registered.date) setCurrentDate(registered.date);
                                router.push('/tasks');
                            }}
                        >
                            Taskelでその日を開く
                        </button>
                        <button type="button" className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-sm" disabled={Boolean(busy)} onClick={cancel}>
                            {busy === 'cancel' ? '取り消し中…' : '登録を取り消す'}
                        </button>
                    </div>
                </div>
            )}

            {(intake.status === 'needs_review' || intake.status === 'failed') && !intake.purged && (
                <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-sm text-gray-600 sm:col-span-2">件名
                        <input className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
                    </label>
                    <label className="text-sm text-gray-600">日付
                        <input type="date" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
                    </label>
                    <label className="text-sm text-gray-600">タイムゾーン
                        <input className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2" value={form.timeZone} onChange={(event) => setForm({ ...form, timeZone: event.target.value })} />
                    </label>
                    <label className="text-sm text-gray-600">開始
                        <input type="time" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2" value={form.startTime} disabled={form.allDay} onChange={(event) => setForm({ ...form, startTime: event.target.value })} />
                    </label>
                    <label className="text-sm text-gray-600">終了
                        <input type="time" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2" value={form.endTime} disabled={form.allDay} onChange={(event) => setForm({ ...form, endTime: event.target.value })} />
                    </label>
                    <label className="text-sm text-gray-600 flex items-center gap-2 sm:col-span-2">
                        <input type="checkbox" checked={form.allDay} onChange={(event) => setForm({ ...form, allDay: event.target.checked })} />
                        終日
                    </label>
                    <label className="text-sm text-gray-600 sm:col-span-2">登録先カレンダー ID
                        <input className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2" value={calendarId} onChange={(event) => setCalendarId(event.target.value)} />
                    </label>
                    {intake.candidates.length > 1 && (
                        <div className="sm:col-span-2 text-sm text-gray-600">
                            他の候補:
                            <ul className="list-disc pl-5">
                                {intake.candidates.slice(1).map((candidate, index) => (
                                    <li key={`${candidate.suggestedTitle}-${index}`}>
                                        <button type="button" className="underline" onClick={() => setForm(formFromCandidate(candidate, settings))}>
                                            {(candidate.suggestedTitle || candidate.title || '無題')} {candidate.suggestedDate || candidate.date} {candidate.suggestedStartTime || ''}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                        <button type="button" className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60" disabled={Boolean(busy)} onClick={register}>
                            {busy === 'register' ? '登録中…' : 'Taskelとカレンダーに登録'}
                        </button>
                        <button type="button" className="px-3 py-2 rounded-lg border border-gray-300 text-sm" disabled={Boolean(busy)} onClick={retry}>解析を再試行</button>
                        {intake.hasGoogleEvent && (
                            <button type="button" className="px-3 py-2 rounded-lg border border-red-200 text-red-700 text-sm" disabled={Boolean(busy)} onClick={cancel}>カレンダー登録を取り消す</button>
                        )}
                        <button type="button" className="px-3 py-2 rounded-lg border border-gray-300 text-sm" disabled={Boolean(busy)} onClick={remove}>受信を削除</button>
                    </div>
                </div>
            )}

            {intake.status === 'cancelled' && (
                <button type="button" className="px-3 py-2 rounded-lg border border-gray-300 text-sm" disabled={Boolean(busy)} onClick={remove}>記録を削除</button>
            )}
            {intake.purged && <p className="text-sm text-gray-500">保存期間が過ぎたため、画像と抽出テキストは削除しました。</p>}
            {(intake.inputTokens !== null || intake.outputTokens !== null) && (
                <p className="text-xs text-gray-400">解析トークン 入力 {intake.inputTokens ?? 0} / 出力 {intake.outputTokens ?? 0}</p>
            )}
        </article>
    );
}

const SHARE_ERROR: Record<string, string> = {
    multiple: '複数の画像は受け取れません。1枚にして共有してください。',
    'not-image': '画像を共有してください。文章の共有はこの入口では受け取りません。アプリ内のテキスト欄を使ってください。',
    invalid: 'この画像は形式またはサイズが対象外です。',
    'too-large': '画像が大きすぎます。',
    'receive-failed': '共有の保存に失敗しました。アプリ内から画像を選んでください。',
};

export function ScheduleInbox({ focusId }: { focusId?: string | null }) {
    const user = useStore((state) => state.user);
    const toggleLeftSidebar = useStore((state) => state.toggleLeftSidebar);
    const [intakes, setIntakes] = useState<ScheduleIntakeView[]>([]);
    const [settings, setSettings] = useState<ScheduleSettings | null>(null);
    const [locals, setLocals] = useState<LocalCapture[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [shareError, setShareError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        const [remote, local] = await Promise.all([
            fetchInbox().catch((loadError: unknown) => {
                setError(loadError instanceof Error ? textOf(loadError.message) : '受信箱を読めませんでした。');
                return null;
            }),
            listLocalCaptures().catch(() => []),
        ]);
        if (remote) {
            setIntakes(remote.intakes);
            setSettings(remote.settings);
            setError(null);
        }
        setLocals(local.filter((item) => item.status !== 'uploaded'));
        setLoading(false);
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        let code = params.get('shareError');
        try {
            if (code) sessionStorage.setItem('taskel_intake_share_error', code);
            else code = sessionStorage.getItem('taskel_intake_share_error');
        } catch {
            // The URL still shows the message for this visit.
        }
        if (code) setShareError(SHARE_ERROR[code] ?? '共有を処理できませんでした。');
        void load();
        const onUpdate = () => { void load(); };
        window.addEventListener('taskel-schedule-updated', onUpdate);
        return () => window.removeEventListener('taskel-schedule-updated', onUpdate);
    }, [load]);

    useEffect(() => {
        if (!user || !shareError) return;
        try {
            sessionStorage.removeItem('taskel_intake_share_error');
        } catch {
            // The message is already on screen.
        }
    }, [user, shareError]);

    useEffect(() => {
        if (!user || !settings) return;
        const pending = readPendingRegister();
        if (!pending) return;
        let cancelled = false;
        void (async () => {
            const token = await currentGoogleAccessToken(user.uid);
            if (!token || cancelled) return;
            try {
                await registerIntakeRequest(pending.intakeId, pending.candidate, pending.calendarId, token);
                clearPendingRegister();
                if (!cancelled) await load();
            } catch {
                // The inbox keeps the draft. The next visit can retry.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user, settings, load]);

    useEffect(() => {
        if (!user || locals.length === 0) return;
        let cancelled = false;
        void (async () => {
            const token = await currentGoogleAccessToken(user.uid);
            for (const local of locals) {
                if (cancelled || local.status === 'uploaded') continue;
                const form = new FormData();
                form.set('source', local.shared ? 'image_share' : local.kind === 'text' ? 'text' : 'image_upload');
                if (local.text) form.set('text', local.text);
                if (local.blob) form.set('image', new File([local.blob], local.name, { type: local.mime }));
                try {
                    await submitIntake(form, token);
                    await removeLocalCapture(local.id);
                } catch (uploadError) {
                    await saveLocalCapture({
                        ...local,
                        status: 'error',
                        error: uploadError instanceof Error ? uploadError.message : 'upload_failed',
                    });
                }
            }
            if (!cancelled) await load();
        })();
        return () => {
            cancelled = true;
        };
    }, [user, locals.length, load]);

    const ordered = useMemo(() => {
        if (!focusId) return intakes;
        return [...intakes].sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0));
    }, [intakes, focusId]);

    return (
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            <div className="flex items-center gap-3">
                <button type="button" className="p-2 rounded-lg hover:bg-gray-100" onClick={toggleLeftSidebar} aria-label="メニュー">
                    <Menu size={20} />
                </button>
                <div>
                    <h1 className="text-xl font-semibold text-gray-900">予定の受信箱</h1>
                    <p className="text-sm text-gray-500">共有や画像は、登録前にここに残ります。</p>
                </div>
            </div>
            {shareError && <p className="text-sm text-red-700 bg-red-50 rounded-lg p-3">{shareError}</p>}
            {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg p-3">{error}</p>}
            {locals.length > 0 && (
                <p className="text-sm text-blue-800 bg-blue-50 rounded-lg p-3">
                    この端末に {locals.length} 件保存しています。{user ? 'サーバーへ送っています。' : 'ログイン後に送信を再開します。'}
                </p>
            )}
            {loading && <p className="text-sm text-gray-500">読み込み中…</p>}
            {!loading && ordered.length === 0 && <p className="text-sm text-gray-500">受信はまだありません。</p>}
            {settings && ordered.map((intake) => (
                <IntakeEditor
                    key={intake.id}
                    intake={intake}
                    settings={settings}
                    onChange={(next) => setIntakes((current) => current.map((item) => item.id === next.id ? next : item))}
                    onRemoved={(id) => setIntakes((current) => current.filter((item) => item.id !== id))}
                />
            ))}
        </div>
    );
}
