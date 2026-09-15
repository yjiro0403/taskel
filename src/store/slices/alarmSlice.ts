import { StateCreator } from 'zustand';

import type { Alarm } from '@/types';
import { StoreState } from '../types';

export interface AlarmCreateInput {
    taskId?: string;
    label?: string;
    fireAt: number; // timestamp (ms)
    snoozeMinutes?: number;
}

export type AlarmUpdateInput = Partial<Pick<Alarm, 'label' | 'fireAt' | 'snoozeMinutes' | 'status'>>;

export interface AlarmSlice {
    alarms: Alarm[];
    alarmsLoaded: boolean;
    fetchAlarms: () => Promise<void>;
    addAlarm: (input: AlarmCreateInput) => Promise<Alarm | null>;
    updateAlarm: (alarmId: string, updates: AlarmUpdateInput) => Promise<boolean>;
    deleteAlarm: (alarmId: string) => Promise<boolean>;
    resetAlarmSlice: () => void;
}

// アラームは Supabase を単一の情報源とし、書き込みは BFF API（/api/alarms）経由で行う。
// 後続フェーズで Capacitor アプリが同テーブルを同期して端末の AlarmManager に登録する。
export const createAlarmSlice: StateCreator<StoreState, [], [], AlarmSlice> = (set, get) => ({
    alarms: [],
    alarmsLoaded: false,

    fetchAlarms: async () => {
        if (!get().user) return;

        try {
            const res = await fetch('/api/alarms');
            if (!res.ok) throw new Error('Failed to fetch alarms');
            const data = await res.json();
            set({ alarms: data.alarms as Alarm[], alarmsLoaded: true });
        } catch (error) {
            console.error('fetchAlarms error:', error);
        }
    },

    addAlarm: async (input) => {
        if (!get().user) return null;

        try {
            const res = await fetch('/api/alarms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });
            if (!res.ok) throw new Error('Failed to create alarm');
            const data = await res.json();
            const alarm = data.alarm as Alarm;
            // alarmsLoaded も同時に立てる。初回の fetchAlarms が失敗していると
            // false のまま固定され、NativeAlarmBridge の同期 effect が
            // 「アラームを何個作っても一度も走らない」状態になるため。
            set((state) => ({ alarms: [...state.alarms, alarm], alarmsLoaded: true }));
            return alarm;
        } catch (error) {
            console.error('addAlarm error:', error);
            get().showToast('アラームの作成に失敗しました。通信環境を確認してください。', 'error');
            return null;
        }
    },

    updateAlarm: async (alarmId, updates) => {
        const { alarms } = get();
        const previous = alarms.find((alarm) => alarm.id === alarmId);
        if (!previous) return false;

        // 楽観的更新。失敗時は対象 id のみ元へ戻す（taskSlice と同じ方針）。
        set((state) => ({
            alarms: state.alarms.map((alarm) => (alarm.id === alarmId ? { ...alarm, ...updates } : alarm)),
        }));

        try {
            const res = await fetch(`/api/alarms/${alarmId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            if (!res.ok) throw new Error('Failed to update alarm');
            const data = await res.json();
            const alarm = data.alarm as Alarm;
            set((state) => ({
                alarms: state.alarms.map((entry) => (entry.id === alarmId ? alarm : entry)),
            }));
            return true;
        } catch (error) {
            console.error('updateAlarm error:', error);
            set((state) => ({
                alarms: state.alarms.map((alarm) => (alarm.id === alarmId ? previous : alarm)),
            }));
            get().showToast('アラームの更新に失敗しました。通信環境を確認してください。', 'error');
            return false;
        }
    },

    deleteAlarm: async (alarmId) => {
        const { alarms } = get();
        const previous = alarms.find((alarm) => alarm.id === alarmId);
        if (!previous) return false;

        set((state) => ({ alarms: state.alarms.filter((alarm) => alarm.id !== alarmId) }));

        try {
            const res = await fetch(`/api/alarms/${alarmId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete alarm');
            return true;
        } catch (error) {
            console.error('deleteAlarm error:', error);
            set((state) => ({ alarms: [...state.alarms, previous] }));
            get().showToast('アラームの削除に失敗しました。通信環境を確認してください。', 'error');
            return false;
        }
    },

    resetAlarmSlice: () => set({ alarms: [], alarmsLoaded: false }),
});
