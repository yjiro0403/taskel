import { StateCreator } from 'zustand';
import { StoreState, CalendarSlice } from '../types';
import { Task } from '@/types';
import { getSectionForTime } from '@/lib/sectionUtils';
import { format } from 'date-fns';

// Google Calendar同期スライス
export const createCalendarSlice: StateCreator<StoreState, [], [], CalendarSlice> = (set, get) => ({
    syncGoogleCalendar: async (accessToken: string, targetDateStr?: string) => {
        const { user, tasks, bulkAddTasks, updateTask, currentDate, sections } = get();
        if (!user) return;

        // 対象日の決定
        const dateStr = targetDateStr || currentDate;
        const targetDate = new Date(dateStr);

        const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
        const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);

        // 循環依存回避のためdynamic import
        const { fetchCalendarEvents } = await import('@/lib/calendarService');

        try {
            const events = await fetchCalendarEvents(accessToken, startOfDay, endOfDay);
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

        } catch (error) {
            console.error("Error syncing calendar:", error);
            alert("Failed to sync calendar.");
        }
    },
});
