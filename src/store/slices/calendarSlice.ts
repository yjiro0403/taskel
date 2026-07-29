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
            GoogleCalendarAuthorizationError,
        } = await import('../../lib/calendarService');

        try {
            // Explicit arg (TaskList / OAuth pending) wins; else UI store currentDate.
            // Never falls back to system "today" — empty/invalid throws.
            const { dateStr, events } = await fetchCalendarEventsForDate(
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
                sections,
                setCurrentDate,
            } = latestState;

            // Keep UI + sessionStorage aligned with the date actually synced (OAuth reload safety).
            if (dateStr !== latestState.currentDate) {
                setCurrentDate(dateStr);
            }

            const tasksToAdd: Task[] = [];
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

                    tasksToAdd.push({
                        id: crypto.randomUUID(),
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
            if (tasksToAdd.length > 0) {
                await bulkAddTasks(tasksToAdd);
                message += `Imported ${tasksToAdd.length} new events. `;
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
