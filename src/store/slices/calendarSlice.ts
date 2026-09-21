import type { StateCreator } from 'zustand';
import type { Task } from '../../types';
import { getSectionForTime } from '../../lib/sectionUtils';
import type { StoreState, CalendarSlice } from '../types';
import { format } from 'date-fns';

// Google Calendar同期スライス
export const createCalendarSlice: StateCreator<StoreState, [], [], CalendarSlice> = (set, get) => ({
    syncGoogleCalendar: async (accessToken: string, targetDateStr?: string | { start: string; end: string }) => {
        const { user, currentDate } = get();
        if (!user) return 'cancelled';
        const syncingUserId = user.uid;

        // 循環依存回避のためdynamic import
        const {
            fetchCalendarEventsForRange,
            isSingleDayRange,
            resolveCalendarSyncRange,
            resolveEventReminderMinutes,
            GoogleCalendarAuthorizationError,
        } = await import('../../lib/calendarService');

        try {
            // Explicit arg (TaskList / OAuth pending) wins; else UI store currentDate.
            // Never falls back to system "today" — empty/invalid throws.
            const range = resolveCalendarSyncRange(targetDateStr, currentDate);
            const { events, defaultReminders } = await fetchCalendarEventsForRange(
                accessToken,
                range.start,
                range.end
            );

            // OAuth return can overlap the initial Supabase data load. Always use
            // the latest store snapshot after the network request, never the empty
            // tasks/sections arrays captured before it.
            const latestState = get();
            if (latestState.user?.uid !== syncingUserId) {
                return 'cancelled';
            }
            const {
                tasks,
                bulkAddTasks,
                updateTask,
                addAlarm,
                sections,
                setCurrentDate,
            } = latestState;

            // Single-day sync keeps the daily list on that day (OAuth reload safety).
            // Week/month imports leave the viewed date alone.
            if (isSingleDayRange(range) && range.start !== latestState.currentDate) {
                setCurrentDate(range.start);
            }

            const tasksToAdd: Task[] = [];
            // 取り込んだイベントの通知（30分前 など）を、タスク作成後にアラーム化する。
            const alarmsToAdd: {
                taskId: string;
                label: string;
                fireAt: number;
                offsetMinutes: number;
            }[] = [];
            let updatedCount = 0;

            for (const event of events) {
                if (!event.summary) continue;

                // イベント日付の取得
                const eventDate = event.start.dateTime
                    ? format(new Date(event.start.dateTime), 'yyyy-MM-dd')
                    : event.start.date;

                if (!eventDate) continue;

                const existingTask = tasks.find(t => t.title === event.summary && t.date === eventDate);

                let scheduledStart = undefined;
                let estimatedMinutes = 30;
                if (event.start.dateTime && event.end.dateTime) {
                    const start = new Date(event.start.dateTime);
                    const end = new Date(event.end.dateTime);

                    scheduledStart = format(start, 'HH:mm');
                    const diffMins = (end.getTime() - start.getTime()) / 60000;
                    estimatedMinutes = diffMins > 0 ? diffMins : 30;
                }

                if (!existingTask) {
                    // 新規タスクの作成
                    let sectionId = sections[0]?.id || 'section-1';
                    if (event.start.dateTime) {
                        const start = new Date(event.start.dateTime);
                        sectionId = getSectionForTime(sections, start);
                    }

                    const taskId = crypto.randomUUID();
                    tasksToAdd.push({
                        id: taskId,
                        userId: user.uid,
                        title: event.summary,
                        sectionId: sectionId,
                        date: eventDate,
                        status: 'open',
                        estimatedMinutes: estimatedMinutes,
                        actualMinutes: 0,
                        scheduledStart: scheduledStart,
                        externalLink: event.htmlLink,
                        order: 999
                    });

                    // Google カレンダー側の通知を Taskel のアラームへ引き継ぐ。
                    // 開始時刻が取れる予定（終日でないもの）だけが対象。
                    if (event.start.dateTime) {
                        const startMs = new Date(event.start.dateTime).getTime();
                        for (const minutes of resolveEventReminderMinutes(event, defaultReminders)) {
                            // Google 側と同じ「何分前」を保存する。以後タスクの開始時刻を
                            // 動かしても、この相対関係は DB のトリガーが維持する。
                            alarmsToAdd.push({
                                taskId,
                                label: event.summary,
                                fireAt: startMs - minutes * 60000,
                                offsetMinutes: minutes,
                            });
                        }
                    }
                } else {
                    // 既存タスクのセクション修復
                    const isValidSection = sections.some(s => s.id === existingTask.sectionId);
                    if (!isValidSection) {
                        let newSectionId = sections[0]?.id || 'section-1';
                        if (existingTask.scheduledStart) {
                            const [hh, mm] = existingTask.scheduledStart.split(':').map(Number);
                            const d = new Date();
                            d.setHours(hh, mm, 0, 0);
                            newSectionId = getSectionForTime(sections, d);
                        }
                        await updateTask(existingTask.id, { sectionId: newSectionId });
                        updatedCount++;
                    }
                }
            }

            let message = '';
            let alarmCount = 0;
            if (tasksToAdd.length > 0) {
                await bulkAddTasks(tasksToAdd);
                message += `Imported ${tasksToAdd.length} new events. `;

                // タスク作成後にアラームを作る（task_id の外部キーを満たすため）。
                // 個々の失敗は同期全体を止めない。
                for (const alarm of alarmsToAdd) {
                    const created = await addAlarm(alarm);
                    if (created) alarmCount++;
                }
                if (alarmCount > 0) {
                    message += `Added ${alarmCount} reminders. `;
                }
            }

            if (updatedCount > 0) {
                message += `Fixed ${updatedCount} existing events.`;
            }

            if (tasksToAdd.length === 0 && updatedCount === 0) {
                alert('No new events to import.');
            } else {
                alert(message);
            }

            return 'success';
        } catch (error) {
            if (error instanceof GoogleCalendarAuthorizationError) {
                return 'auth_required';
            }
            console.error("Error syncing calendar:", error);
            alert("Failed to sync calendar.");
            return 'failed';
        }
    },
});
