import type { StateCreator } from 'zustand';
import type { Task } from '../../types';
import { getSectionForTime } from '../../lib/sectionUtils';
import type { StoreState, CalendarSlice } from '../types';
import { format } from 'date-fns';

// Google Calendar同期スライス
export const createCalendarSlice: StateCreator<StoreState, [], [], CalendarSlice> = (set, get) => ({
    syncGoogleCalendar: async (accessToken: string, targetDateStr?: string) => {
        const { user, currentDate } = get();
        if (!user) return 'cancelled';
        const syncingUserId = user.uid;

        // 循環依存回避のためdynamic import
        const {
            fetchCalendarEventsForDate,
            duplicateCalendarImportIds,
            findAlreadyImportedTask,
            resolveEventReminderMinutes,
            GoogleCalendarAuthorizationError,
        } = await import('../../lib/calendarService');

        try {
            // Explicit arg (TaskList / OAuth pending) wins; else UI store currentDate.
            // Never falls back to system "today" — empty/invalid throws.
            const { dateStr, events, defaultReminders } = await fetchCalendarEventsForDate(
                accessToken,
                targetDateStr,
                currentDate
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
                bulkDeleteTasks,
                sections,
                setCurrentDate,
            } = latestState;

            // Keep UI + sessionStorage aligned with the date actually synced (OAuth reload safety).
            if (dateStr !== latestState.currentDate) {
                setCurrentDate(dateStr);
            }

            const tasksToAdd: Task[] = [];
            // A title/day match can only stand in for one event per import.
            const claimedTaskIds = new Set<string>();
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

                let scheduledStart = undefined;
                let estimatedMinutes = 30;
                if (event.start.dateTime && event.end.dateTime) {
                    const start = new Date(event.start.dateTime);
                    const end = new Date(event.end.dateTime);

                    scheduledStart = format(start, 'HH:mm');
                    const diffMins = (end.getTime() - start.getTime()) / 60000;
                    estimatedMinutes = diffMins > 0 ? diffMins : 30;
                }

                // 同じ予定（リンク先）は、タイトルや日付を変えていても取り込まない。
                // この応答の中で同じ予定が2回来ても、1件だけにする。
                if (findAlreadyImportedTask(tasksToAdd, event, eventDate, scheduledStart, claimedTaskIds)) {
                    continue;
                }
                const existingTask = findAlreadyImportedTask(tasks, event, eventDate, scheduledStart, claimedTaskIds);

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
                    if (existingTask.id) claimedTaskIds.add(existingTask.id);
                    // 既存タスクのセクション修復。リンク未保存の古い取り込みにはリンクを足す。
                    const isValidSection = sections.some(s => s.id === existingTask.sectionId);
                    const patch: Partial<Task> = {};
                    if (!isValidSection) {
                        let newSectionId = sections[0]?.id || 'section-1';
                        if (existingTask.scheduledStart) {
                            const [hh, mm] = existingTask.scheduledStart.split(':').map(Number);
                            const d = new Date();
                            d.setHours(hh, mm, 0, 0);
                            newSectionId = getSectionForTime(sections, d);
                        }
                        patch.sectionId = newSectionId;
                    }
                    if (event.htmlLink && !existingTask.externalLink) {
                        patch.externalLink = event.htmlLink;
                    }
                    if (patch.sectionId || patch.externalLink) {
                        await updateTask(existingTask.id, patch);
                        updatedCount++;
                    }
                }
            }

            // すでに入っている同じ予定の、未着手のコピーを捨てる。記録のある方は残す。
            const duplicateIds = duplicateCalendarImportIds(tasks);
            let removedCount = 0;
            if (duplicateIds.length > 0) {
                await bulkDeleteTasks(duplicateIds);
                removedCount = duplicateIds.length;
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
                message += `Fixed ${updatedCount} existing events. `;
            }

            if (removedCount > 0) {
                message += `Removed ${removedCount} duplicate events.`;
            }

            if (tasksToAdd.length === 0 && updatedCount === 0 && removedCount === 0) {
                alert('No new events to import.');
            } else {
                alert(message.trim());
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
