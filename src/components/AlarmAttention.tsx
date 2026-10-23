'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlarmClock } from 'lucide-react';

import { listRingingAlarms } from '@/lib/alarms/ringing';
import { createClient } from '@/lib/supabase/client';
import { mapAlarm } from '@/lib/supabase/mappers';
import { subscribeTable, unsubscribeChannels } from '@/lib/supabase/data';
import { useStore } from '@/store/useStore';
import type { Database } from '@/types/supabase';

type AlarmRow = Database['public']['Tables']['alarms']['Row'];

function playAttentionTone() {
    const AudioContextCtor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.4);
    oscillator.onended = () => {
        void ctx.close();
    };
}

function notifyIfBackground(title: string, body: string, tag: string) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    const notification = new Notification(title, { body, tag });
    notification.onclick = () => {
        window.focus();
        notification.close();
    };
}

/**
 * 鳴動中のアラームを、開いている Taskel（Web を含む）に出す。
 * 停止はサーバー経由で登録済みの Android 端末へ届く。
 */
export function AlarmAttention() {
    const t = useTranslations('AlarmAttention');
    const locale = useLocale();
    const user = useStore((state) => state.user);
    const alarms = useStore((state) => state.alarms);
    const fetchAlarms = useStore((state) => state.fetchAlarms);
    const applyRemoteAlarm = useStore((state) => state.applyRemoteAlarm);
    const removeRemoteAlarm = useStore((state) => state.removeRemoteAlarm);
    const updateAlarm = useStore((state) => state.updateAlarm);
    const [pendingIds, setPendingIds] = useState<string[]>([]);
    const announcedIds = useRef(new Set<string>());
    const baseTitle = useRef<string | null>(null);

    const ringing = listRingingAlarms(alarms);

    useEffect(() => {
        if (!user) return;
        void fetchAlarms();
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                void fetchAlarms();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [user, fetchAlarms]);

    useEffect(() => {
        if (!user) return;
        const supabase = createClient();
        let sawSubscribed = false;
        const channel = subscribeTable(
            supabase,
            `alarms:${user.uid}`,
            'alarms',
            (payload) => {
                if (payload.eventType === 'DELETE') {
                    const id = payload.old?.id;
                    if (typeof id === 'string') removeRemoteAlarm(id);
                    return;
                }
                const row = payload.new as unknown as AlarmRow;
                if (!row?.id) return;
                applyRemoteAlarm(mapAlarm(row));
            },
            `user_id=eq.${user.uid}`,
            (status) => {
                if (status !== 'SUBSCRIBED') return;
                if (!sawSubscribed) {
                    sawSubscribed = true;
                    return;
                }
                void fetchAlarms();
            }
        );
        return () => {
            void unsubscribeChannels(supabase, [channel]);
        };
    }, [user, applyRemoteAlarm, removeRemoteAlarm, fetchAlarms]);

    useEffect(() => {
        if (baseTitle.current === null) {
            baseTitle.current = document.title.replace(/^\(\d+\) .+ — /, '');
        }
        const base = baseTitle.current;
        if (ringing.length === 0) {
            if (document.title !== base) document.title = base;
            announcedIds.current.clear();
            return;
        }
        const nextTitle = `(${ringing.length}) ${t('title')} — ${base}`;
        if (document.title !== nextTitle) document.title = nextTitle;

        for (const alarm of ringing) {
            if (announcedIds.current.has(alarm.id)) continue;
            announcedIds.current.add(alarm.id);
            const label = alarm.label?.trim() || t('untitled');
            notifyIfBackground(t('title'), label, `alarm-${alarm.id}`);
            if (document.visibilityState === 'visible') {
                try {
                    playAttentionTone();
                } catch {
                    // 自動再生が拒否されても、バナー自体は残る。
                }
                navigator.vibrate?.([180, 80, 180]);
            }
        }
    }, [ringing, t]);

    if (ringing.length === 0) {
        return null;
    }

    const timeFormatter = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });

    const handleStop = async (alarmId: string) => {
        setPendingIds((current) => (current.includes(alarmId) ? current : [...current, alarmId]));
        try {
            await updateAlarm(alarmId, { status: 'dismissed' });
        } finally {
            setPendingIds((current) => current.filter((id) => id !== alarmId));
        }
    };

    return (
        <div className="fixed top-4 left-4 right-4 z-[70] flex justify-center pointer-events-none">
            <div
                role="alertdialog"
                aria-labelledby="alarm-attention-title"
                aria-live="assertive"
                className="pointer-events-auto w-full max-w-md overflow-hidden rounded-xl border border-rose-200 bg-white text-gray-900 shadow-2xl"
            >
                <div className="flex items-center gap-2 bg-rose-600 px-4 py-3 text-white">
                    <AlarmClock size={18} className="animate-pulse shrink-0" />
                    <h2 id="alarm-attention-title" className="font-semibold">
                        {t('title')}
                    </h2>
                </div>
                <ul>
                    {ringing.map((alarm) => {
                        const pending = pendingIds.includes(alarm.id);
                        const label = alarm.label?.trim() || t('untitled');
                        return (
                            <li
                                key={alarm.id}
                                className="flex items-center gap-3 border-t border-rose-100 px-4 py-3"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium">{label}</p>
                                    <p className="text-sm text-gray-500">{timeFormatter.format(alarm.fireAt)}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void handleStop(alarm.id)}
                                    disabled={pending}
                                    className="min-h-[44px] shrink-0 rounded-lg bg-rose-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
                                >
                                    {pending ? t('stopping') : t('stop')}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
