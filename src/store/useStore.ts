// Force rebuild: 2026-01-16
import { create } from 'zustand';
import { Task, Section, Routine, Tag, DailyNote, Project, HubRole, WeeklyNote, MonthlyNote, YearlyNote } from '@/types';
import { mockTasks, mockSections } from '@/data/mockData';
import { getSectionForTime } from '@/lib/sectionUtils';
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    query,
    onSnapshot,
    setDoc,
    writeBatch,
    where,
    getDocs
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Unsubscribe } from 'firebase/auth';
import { addDays, addMonths, format, parseISO, isBefore, isSameDay } from 'date-fns';

// Helper to remove undefined values before Firestore operations
const sanitizeData = (data: any) => {
    const clean: any = {};
    Object.keys(data).forEach(key => {
        if (data[key] !== undefined) {
            clean[key] = data[key];
        }
    });
    return clean;
};

// Helper to handle Firestore errors gracefully (suppress permission-denied noise)
const handleFirestoreError = (error: any, context: string) => {
    if (error?.code === 'permission-denied') {
        console.warn(`Firestore permission denied (${context}): User might be logged out or deleted.`);
    } else {
        console.error(`Error fetching ${context}:`, error);
    }
};

// Generic Note Saver
const saveNoteGeneric = async (
    collectionName: 'dailyNotes' | 'weeklyNotes' | 'monthlyNotes' | 'yearlyNotes',
    noteId: string,
    content: string,
    user: import('firebase/auth').User | null,
    set: any,
    get: any
) => {
    if (!user) return;

    // Optimistic Update
    const stateKey = collectionName; // 'dailyNotes', 'weeklyNotes', etc.
    const note = {
        id: noteId,
        userId: user.uid,
        content,
        updatedAt: Date.now()
    };

    set((state: any) => {
        const existingIndex = state[stateKey].findIndex((n: any) => n.id === noteId);
        if (existingIndex >= 0) {
            const newNotes = [...state[stateKey]];
            newNotes[existingIndex] = note;
            return { [stateKey]: newNotes };
        } else {
            return { [stateKey]: [...state[stateKey], note] };
        }
    });

    try {
        const ref = doc(db, 'users', user.uid, collectionName, noteId);
        await setDoc(ref, note, { merge: true });
    } catch (error) {
        console.error(`Error saving ${collectionName}:`, error);
        // We could revert here but simpler to just log for now as it's minor data
    }
};

interface StoreState {
    tasks: Task[];
    sections: Section[];
    routines: Routine[];
    tags: Tag[]; // NEW
    projects: Project[]; // NEW
    currentTime: Date;
    setCurrentTime: (time: Date) => void;
    addTask: (task: Task) => void;
    updateTask: (taskId: string, updates: Partial<Task>) => void;
    duplicateTask: (taskId: string) => Promise<void>;
    deleteTask: (taskId: string) => void;
    selectedTaskIds: string[];
    toggleTaskSelection: (taskId: string) => void;
    currentDate: string; // YYYY-MM-DD
    setCurrentDate: (date: string) => void;
    bulkUpdateTasks: (taskIds: string[], updates: Partial<Task>) => void;
    clearSelection: () => void;
    user: import('firebase/auth').User | null;
    setUser: (user: import('firebase/auth').User | null) => void;
    unsubscribe: (() => void) | null;

    // Section Actions
    addSection: (section: Section) => Promise<void>;
    updateSection: (sectionId: string, updates: Partial<Section>) => Promise<void>;
    deleteSection: (sectionId: string) => Promise<void>;

    // Routine Actions
    addRoutine: (routine: Routine) => void;
    updateRoutine: (routineId: string, updates: Partial<Routine>) => void;
    deleteRoutine: (routineId: string) => void;
    bulkAddTasks: (tasks: Task[]) => Promise<void>;
    bulkDeleteTasks: (taskIds: string[]) => Promise<void>;
    syncGoogleCalendar: (accessToken: string, targetDateStr?: string) => Promise<void>;
    getMergedTasks: (date: string) => Task[];

    // Tag Actions
    addTag: (tag: Tag) => Promise<string>; // Returns ID
    updateTag: (tagId: string, updates: Partial<Tag>) => void;
    deleteTag: (tagId: string) => void;

    // Project Actions
    addProject: (project: Omit<Project, 'ownerId' | 'memberIds' | 'roles'>) => Promise<void>;
    updateProject: (projectId: string, updates: Partial<Project>) => Promise<void>;
    deleteProject: (projectId: string) => Promise<void>;
    inviteMember: (projectId: string, email: string) => Promise<{ success: boolean; message: string }>;
    generateInviteLink: (projectId: string, email?: string, role?: HubRole) => Promise<{ success: boolean; joinLink?: string; message: string }>;
    joinProjectWithToken: (token: string) => Promise<{ success: boolean; projectId?: string; message: string }>;

    getUniqueTags: () => string[];

    // UI Sidebar State
    isRightSidebarOpen: boolean;
    toggleRightSidebar: () => void;
    isLeftSidebarOpen: boolean;
    toggleLeftSidebar: () => void;

    // Daily Notes
    dailyNotes: DailyNote[];
    isDailyNoteModalOpen: boolean;
    toggleDailyNoteModal: () => void;
    saveDailyNote: (date: string, content: string) => Promise<void>;

    // Weekly Notes
    weeklyNotes: WeeklyNote[];
    saveWeeklyNote: (weekId: string, content: string) => Promise<void>;

    // Monthly Notes
    monthlyNotes: MonthlyNote[];
    saveMonthlyNote: (monthId: string, content: string) => Promise<void>;

    // Yearly Notes
    yearlyNotes: YearlyNote[];
    saveYearlyNote: (yearId: string, content: string) => Promise<void>;

    reorderTasks: (taskIds: string[]) => Promise<void>;
    rebuildSections: () => Promise<void>;
    migrateTasks: () => Promise<{ success: boolean; message: string; count: number }>;
}

export const useStore = create<StoreState>((set, get) => ({
    // ... existing state ... 

    // 159: ...
    // 273: 

    syncGoogleCalendar: async (accessToken: string, targetDateStr?: string) => {
        const { user, tasks, bulkAddTasks, updateTask, currentDate, sections } = get();
        if (!user) return;

        // Use provided targetDate or currentDate from store, or fallback to today
        const dateStr = targetDateStr || currentDate;
        const targetDate = new Date(dateStr);

        // startOfDay: 00:00:00
        const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
        // endOfDay: 23:59:59
        const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);

        // Dynamic import to avoid circular dep issues or just import normally if fine
        const { fetchCalendarEvents } = await import('@/lib/calendarService');

        try {
            const events = await fetchCalendarEvents(accessToken, startOfDay, endOfDay);
            const tasksToAdd: Task[] = [];
            let updatedCount = 0;



            for (const event of events) {
                if (!event.summary) continue;

                // Deduping: Check if task with same title and date exists
                // Enhancing: Check if we already imported this event ID?
                // For now, simple Title + Date check
                const eventDate = event.start.dateTime
                    ? format(new Date(event.start.dateTime), 'yyyy-MM-dd')
                    : event.start.date;  // All day event

                if (!eventDate) continue; // Should not happen

                const existingTask = tasks.find(t => t.title === event.summary && t.date === eventDate);

                let scheduledStart = undefined;
                let estimatedMinutes = 30; // Default
                if (event.start.dateTime && event.end.dateTime) {
                    // Fix Timezone: event.start.dateTime is ISO with offset (e.g., ...+09:00).
                    // new Date() parses it to local Date object correctly.
                    const start = new Date(event.start.dateTime);
                    const end = new Date(event.end.dateTime);

                    scheduledStart = format(start, 'HH:mm');
                    const diffMins = (end.getTime() - start.getTime()) / 60000;
                    estimatedMinutes = diffMins > 0 ? diffMins : 30;
                }

                if (!existingTask) {
                    // Create Task
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
                        externalLink: event.htmlLink, // Save Google Calendar Link
                        order: 999
                    });
                } else {
                    // Check if existing task has invalid sectionId or needs update
                    const isValidSection = sections.some(s => s.id === existingTask.sectionId);
                    if (!isValidSection) {
                        // Self-heal: Update sectionId
                        let newSectionId = sections[0]?.id || 'section-1';
                        if (existingTask.scheduledStart) {
                            // We need a Date object. Reconstruct or just assume today + time?
                            // getSectionForTime needs only time part.
                            // But it takes Date.
                            // Let's create a dummy date with this time.
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
                console.log(`Importing ${tasksToAdd.length} events from Google Calendar...`);
                await bulkAddTasks(tasksToAdd);
                message += `Imported ${tasksToAdd.length} new events. `;
            }

            if (updatedCount > 0) {
                console.log(`Fixed ${updatedCount} existing events with valid sections.`);
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

    getUniqueTags: () => {
        // Now returns names from global tags + legacy local tags?
        // For simple migration: Return all names from `tags` collection AND legacy strings in tasks
        const { tasks, tags } = get();
        const tagSet = new Set<string>();

        // Add global tags
        tags.forEach(t => tagSet.add(t.name));

        // Add legacy task tags (if any not covered)
        tasks.forEach(task => {
            if (task.tags) {
                task.tags.forEach(tag => tagSet.add(tag));
            }
        });
        return Array.from(tagSet).sort();
    },

    tasks: [],
    sections: [],
    // ... (rest of state items are fine, we just update the impl below)
    routines: [],
    tags: [], // Initial state
    projects: [], // Initial state
    dailyNotes: [], // Initial state
    weeklyNotes: [], // Initial state
    monthlyNotes: [],
    yearlyNotes: [],
    isDailyNoteModalOpen: false,
    isRightSidebarOpen: false,
    isLeftSidebarOpen: false,
    currentTime: new Date(),
    currentDate: new Date().toISOString().split('T')[0],
    selectedTaskIds: [],
    unsubscribe: null,

    setCurrentTime: (time) => set({ currentTime: time }),
    setCurrentDate: (date) => set({ currentDate: date }),

    addTask: async (task) => {
        const { user } = get();
        if (user) {
            // Optimistic update
            const oldTasks = get().tasks;
            set((state) => ({ tasks: [...state.tasks, task] }));

            try {
                // UNIFIED STORAGE: Always use global 'tasks' collection
                // This replaces the old logic of split collections.
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task: { ...task, userId: user.uid }, action: 'create' })
                });

                if (!response.ok) {
                    throw new Error('Failed to create task via API');
                }
            } catch (error) {
                console.error("Error adding task via API: ", error);
                // Revert optimistic update
                set({ tasks: oldTasks });
                alert("Failed to add task. Please check your connection.");
            }
        } else {
            set((state) => ({ tasks: [...state.tasks, task] }));
        }
    },

    updateTask: async (taskId, updates) => {
        const { user, tasks, getMergedTasks } = get();
        if (user) {
            const oldTasks = tasks;
            // Optimistic update
            set((state) => ({
                tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
            }));

            try {
                const task = tasks.find(t => t.id === taskId);
                let isVirtual = false;
                let fullTaskForCreation: Task | null = null;

                // Instantiation Logic: If task doesn't exist in DB, it might be a virtual task
                if (!task) {
                    const dateStr = taskId.split('-').slice(-3).join('-'); // Extract YYYY-MM-DD
                    const merged = getMergedTasks(dateStr);
                    const virtualTask = merged.find(t => t.id === taskId);

                    if (virtualTask) {
                        isVirtual = true;
                        fullTaskForCreation = {
                            ...virtualTask,
                            ...updates,
                            userId: user.uid,
                        };
                        // We also update the local store to include this new task so further updates work
                        // (Wait, optimistic update above might have failed if task wasn't in state.tasks)
                        // Actually the optimistic update above map() wouldn't affect if task is not in array.
                        // So we need to handle optimistic instantiation too.
                        set((state) => ({ tasks: [...state.tasks, fullTaskForCreation as Task] }));
                    }
                }

                if (isVirtual && fullTaskForCreation) {
                    console.log("Instantiating virtual task via API:", taskId);
                    const response = await fetch('/api/tasks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ task: fullTaskForCreation, action: 'create' })
                    });
                    if (!response.ok) throw new Error('Failed to instantiate task via API');
                    return;
                }

                if (!task && !isVirtual) {
                    // Check if it was in the oldTasks (maybe just disappeared from view in optimistic update? no)
                    // If we are here, it means we tried to update a task that is not in state and not virtual.
                    // But wait, if it was in state, `task` (found from `tasks` const which is `get().tasks`) should be defined.
                    console.error("Task not found for update:", taskId);
                    // If we executed optimistic update, but task wasn't found, then optimistic update did nothing.
                    return;
                }

                // Standard Update
                const isProjectChange = updates.projectId !== undefined && updates.projectId !== task?.projectId;
                const payloadAction = isProjectChange ? 'create' : 'update'; // If moving, we treat as create to ensure all fields are set in new doc

                // If moving projects, we need to send the FULL task data because the backend "create" 
                // needs to know everything to set up the new document. 
                // "update" only applies partial fields.
                // However, our API 'create' logic expects `task` object.

                // Fix lint error by explicitly typing as any for this temporary reassignment logic
                let payloadTask: any = {
                    id: taskId,
                    userId: user.uid,
                    projectId: task?.projectId, // CRITICAL FIX: Include projectId so API targets correct collection
                    ...updates
                };
                console.log("useStore payloadTask:", payloadTask);

                if (isProjectChange && task) {
                    // Merge existing task data with updates to ensure nothing is lost during the move
                    payloadTask = {
                        ...task,
                        ...updates,
                        userId: user.uid // Ensure userId is correct
                    };
                }

                // UNIFIED STORAGE: Update always targets global collection.
                // The API route will handle the writing to 'tasks' collection.
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        task: payloadTask,
                        action: payloadAction
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to update task via API');
                }

                // Cleanup: With unified storage, we don't need to delete old documents when moving projects
                // because it's the same document ID in the same collection.
                // BUT, if we are migrating legacy data on the fly (moving from private to global manually),
                // we might need cleanup. But here we assume we are fully unified.
                // If this is a project move, the ID stays the same, just projectId field changes.
                // So no deleteDoc needed anymore! Unified Storage wins.


            } catch (error) {
                console.error("Error updating task via API: ", error);
                // Revert
                set({ tasks: oldTasks });
                alert("Failed to update task. Please check your connection.");
            }
        } else {
            set((state) => ({
                tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
            }));
        }
    },

    bulkUpdateTasks: async (taskIds, updates) => {
        const { user, tasks } = get();
        if (user) {
            // Because we might have mixed "correct" and "incorrect" locations for shared tasks,
            // However, bulk actions are optimization.
            // For now, let's keep it simple: try standard way. If this becomes an issue, we rewrite.
            // The critical fix is bulkAddTasks.
            try {
                const batch = writeBatch(db);
                taskIds.forEach((id) => {
                    // Unified Storage: always 'tasks' collection
                    const ref = doc(db, 'tasks', id);
                    batch.update(ref, sanitizeData({
                        ...updates,
                        updatedAt: Date.now()
                    }));
                });
                await batch.commit();
                set({ selectedTaskIds: [] });
            } catch (error) {
                console.error("Error bulk updating tasks: ", error);
            }
        } else {
            set((state) => ({
                tasks: state.tasks.map((t) => (taskIds.includes(t.id) ? { ...t, ...updates } : t)),
                selectedTaskIds: [],
            }));
        }
    },

    duplicateTask: async (taskId: string) => {
        const { tasks, addTask, getMergedTasks, currentDate } = get();
        // Try to find in current tasks
        let task = tasks.find(t => t.id === taskId);

        // Fallback: Check if it's a virtual task for the current date
        if (!task) {
            const mergedTasks = getMergedTasks(currentDate);
            task = mergedTasks.find(t => t.id === taskId);
        }

        if (task) {
            const newTask: Task = {
                ...task,
                id: crypto.randomUUID(),
                title: `${task.title} (copy)`,
                status: 'open',
                actualMinutes: 0,
                startedAt: undefined,
                completedAt: undefined,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                order: task.order + 0.1, // Insert slightly after
            };
            await addTask(newTask);
        }
    },

    deleteTask: async (taskId) => {
        const { user, tasks, getMergedTasks } = get();
        if (user) {
            try {
                // Check if it's a virtual task (routine instance)
                if (taskId.startsWith('routine-')) {
                    const dateStr = taskId.split('-').slice(-3).join('-'); // routine-{id}-{YYYY-MM-DD}

                    // We need to fetch the virtual task data to create it as 'skipped'
                    // If we just gathered it from `tasks`, it might not be there. 
                    // But if the user clicked delete, they presumably saw it, so it's in getMergedTasks.
                    const merged = getMergedTasks(dateStr);
                    const virtualTask = merged.find(t => t.id === taskId);

                    if (virtualTask) {
                        const skippedTask = {
                            ...virtualTask,
                            userId: user.uid,
                            status: 'skipped' as const,
                            updatedAt: Date.now()
                        };
                        // Create it as skipped so it persists and blocks future virtual generation
                        // Unified Storage: 'tasks' collection
                        const ref = doc(db, 'tasks', taskId);  // Use same deterministic ID
                        await setDoc(ref, sanitizeData(skippedTask));
                    }
                } else {
                    // Unified Storage: always 'tasks' collection
                    const ref = doc(db, 'tasks', taskId);
                    await deleteDoc(ref);
                }
            } catch (error) {
                console.error("Error deleting task: ", error);
            }
        } else {
            set((state) => ({
                tasks: state.tasks.filter((t) => t.id !== taskId),
            }));
        }
    },

    bulkDeleteTasks: async (taskIds: string[]) => {
        const { user, tasks, getMergedTasks } = get();
        if (user) {
            try {
                const batch = writeBatch(db);

                // We might need to look up virtual tasks across different dates if multiple selected
                // Optimization: Group by date if needed, or just lazy fetch if performant enough.
                // Since we don't know the date easily from just ID for all cases (though we do for routine-),
                // let's rely on the ID structure for virtual tasks.

                for (const id of taskIds) {
                    if (id.startsWith('routine-')) {
                        // routine-{routineId}-{YYYY-MM-DD}
                        // The ID format is `routine-${routine.id}-${dateStr}`
                        // We need to extract the date part carefully. routine IDs are UUIDs (usually).
                        // Let's assume the last 3 parts are YYYY-MM-DD
                        const parts = id.split('-');
                        if (parts.length >= 5) { // routine, uuid parts..., yyyy, mm, dd
                            const dateStr = parts.slice(-3).join('-');

                            // We need to find the task object to save it. 
                            // Try finding in current merged view if possible?
                            // But `getMergedTasks` takes a specific date. 
                            // Checking `tasks` in store won't help for virtuals.
                            // So we must call `getMergedTasks(dateStr)`.
                            const merged = getMergedTasks(dateStr);
                            const virtualTask = merged.find(t => t.id === id);

                            if (virtualTask) {
                                const skippedTask = {
                                    ...virtualTask,
                                    userId: user.uid,
                                    status: 'skipped' as const,
                                    updatedAt: Date.now()
                                };
                                const ref = doc(db, 'tasks', id);
                                batch.set(ref, sanitizeData(skippedTask));
                            }
                        }
                    } else {
                        // Standard delete
                        const ref = doc(db, 'tasks', id);
                        batch.delete(ref);
                    }
                }

                await batch.commit();
                set({ selectedTaskIds: [] });
            } catch (error) {
                console.error("Error bulk deleting tasks: ", error);
            }
        } else {
            set((state) => ({
                tasks: state.tasks.filter((t) => !taskIds.includes(t.id)),
                selectedTaskIds: [],
            }));
        }
    },

    toggleTaskSelection: (taskId) =>
        set((state) => ({
            selectedTaskIds: state.selectedTaskIds.includes(taskId)
                ? state.selectedTaskIds.filter((id) => id !== taskId)
                : [...state.selectedTaskIds, taskId],
        })),

    clearSelection: () => set({ selectedTaskIds: [] }),

    reorderTasks: async (taskIds: string[]) => {
        const { user, tasks } = get();
        // Optimistic update: set orders based on the index in taskIds array
        const newTasks = tasks.map(t => {
            const newIndex = taskIds.indexOf(t.id);
            if (newIndex >= 0) {
                return { ...t, order: newIndex };
            }
            return t;
        });

        set({ tasks: newTasks });

        if (user) {
            try {
                const batch = writeBatch(db);
                taskIds.forEach((id, index) => {
                    const ref = doc(db, 'tasks', id);
                    batch.update(ref, { order: index, updatedAt: Date.now() });
                });
                await batch.commit();
            } catch (error) {
                console.error("Error reordering tasks: ", error);
                // We don't revert here to avoid flickers, as order is usually not critical if it fails once
            }
        }
    },

    // --- Section Actions ---
    // ... (unchanged) ...


    // --- Section Actions ---
    addSection: async (section) => {
        const { user } = get();
        if (user) {
            try {
                // Use direct Firestore to match rebuildSections and avoid 404 on missing API
                const ref = doc(collection(db, 'users', user.uid, 'sections'), section.id || undefined);
                await setDoc(ref, sanitizeData({ ...section, id: ref.id }));
            } catch (error) {
                console.error("Error adding section: ", error);
            }
        }
    },

    updateSection: async (sectionId, updates) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(db, 'users', user.uid, 'sections', sectionId);
                await updateDoc(ref, sanitizeData(updates));
            } catch (error) {
                console.error("Error updating section: ", error);
            }
        }
    },

    deleteSection: async (sectionId) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(db, 'users', user.uid, 'sections', sectionId);
                await deleteDoc(ref);
            } catch (error) {
                console.error("Error deleting section: ", error);
            }
        }
    },

    // --- Project Actions ---
    addProject: async (project) => {
        const { user } = get();
        if (user) {
            try {
                // Use top-level projects collection
                const ref = doc(collection(db, 'projects'), project.id || undefined);
                await setDoc(ref, sanitizeData({
                    ...project,
                    id: ref.id,
                    userId: user.uid,
                    ownerId: user.uid, // Set owner
                    memberIds: [user.uid], // Set initial member
                    roles: { [user.uid]: 'owner' }, // Initial role
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                }));
            } catch (error) {
                console.error("Error adding project: ", error);
            }
        }
    },

    updateProject: async (projectId, updates) => {
        const { user } = get();
        if (user) {
            try {
                // Use top-level projects collection
                const ref = doc(db, 'projects', projectId);
                await updateDoc(ref, sanitizeData({
                    ...updates,
                    updatedAt: Date.now()
                }));
            } catch (error) {
                console.error("Error updating project: ", error);
            }
        }
    },

    deleteProject: async (projectId) => {
        const { user } = get();
        if (user) {
            try {
                // Use top-level projects collection
                const ref = doc(db, 'projects', projectId);
                await deleteDoc(ref);
            } catch (error) {
                console.error("Error deleting project: ", error);
            }
        }
    },

    inviteMember: async (projectId, email) => {
        const { user } = get();
        if (!user) return { success: false, message: 'Not authenticated' };

        try {
            const token = await user.getIdToken();
            const response = await fetch(`/api/projects/${projectId}/invite`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            if (!response.ok) {
                return { success: false, message: data.error || 'Failed to invite user' };
            }

            return { success: true, message: 'Invitation sent successfully' };
        } catch (error) {
            console.error("Error inviting member:", error);
            return { success: false, message: 'Network error or server unavailable' };
        }
    },

    generateInviteLink: async (projectId, email, role = 'member') => {
        const { user } = get();
        if (!user) return { success: false, message: 'Not authenticated' };
        try {
            const token = await user.getIdToken();
            const response = await fetch('/api/invitations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ projectId, email, role })
            });
            const data = await response.json();
            if (!response.ok) return { success: false, message: data.error || 'Failed to generate link' };
            return { success: true, joinLink: data.joinLink, message: 'Link generated' };
        } catch (error) {
            console.error("Error generating link:", error);
            return { success: false, message: 'Network error' };
        }
    },

    joinProjectWithToken: async (inviteToken) => {
        const { user } = get();
        if (!user) return { success: false, message: 'Not authenticated' };
        try {
            const token = await user.getIdToken();
            const response = await fetch('/api/invitations/join', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ inviteToken })
            });
            const data = await response.json();
            if (!response.ok) return { success: false, message: data.error || 'Failed to join' };
            return { success: true, projectId: data.projectId, message: data.message };
        } catch (error) {
            console.error("Error joining with token:", error);
            return { success: false, message: 'Network error' };
        }
    },

    // --- Routine Actions ---
    addRoutine: async (routine) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(collection(db, 'users', user.uid, 'routines'), routine.id || undefined);
                const newRoutine = {
                    ...routine,
                    id: ref.id,
                    userId: user.uid,
                    startDate: routine.startDate || format(new Date(), 'yyyy-MM-dd')
                };
                await setDoc(ref, sanitizeData(newRoutine));
            } catch (error) {
                console.error("Error adding routine: ", error);
            }
        }
    },

    updateRoutine: async (routineId, updates) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(db, 'users', user.uid, 'routines', routineId);
                await updateDoc(ref, sanitizeData(updates));
            } catch (error) {
                console.error("Error updating routine: ", error);
            }
        }
    },

    deleteRoutine: async (routineId) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(db, 'users', user.uid, 'routines', routineId);
                await deleteDoc(ref);
            } catch (error) {
                console.error("Error deleting routine: ", error);
            }
        }
    },

    bulkAddTasks: async (tasksToAdd) => {
        const { user } = get();
        if (user) {
            try {
                const batch = writeBatch(db);
                tasksToAdd.forEach(task => {
                    // Unified Storage: always 'tasks' collection
                    const ref = doc(db, 'tasks', task.id || crypto.randomUUID());

                    batch.set(ref, sanitizeData({
                        ...task,
                        id: ref.id,
                        userId: user.uid,
                        createdAt: task.createdAt || Date.now(),
                        updatedAt: Date.now()
                    }));
                });
                await batch.commit();
            } catch (error) {
                console.error("Error bulk adding tasks: ", error);
                throw error;
            }
        } else {
            set((state) => ({ tasks: [...state.tasks, ...tasksToAdd] }));
        }
    },

    getMergedTasks: (dateStr: string) => {
        const { tasks, routines } = get();
        // 1. Get all DB tasks for this date (including skipped)
        const dbTasks = tasks.filter(t => t.date === dateStr);

        // 2. Determine target date for processing
        const targetDate = parseISO(dateStr);

        const virtualTasks: Task[] = [];

        routines.forEach(routine => {
            if (!routine.active) return;
            const startDate = parseISO(routine.startDate || routine.nextRun);
            if (isBefore(targetDate, startDate) && !isSameDay(targetDate, startDate)) return;

            // Check frequency
            let matches = false;
            if (routine.frequency === 'daily') {
                matches = true;
            } else if (routine.frequency === 'weekly') {
                if (routine.daysOfWeek && routine.daysOfWeek.length > 0) {
                    matches = routine.daysOfWeek.includes(targetDate.getDay());
                } else {
                    matches = targetDate.getDay() === startDate.getDay();
                }
            } else if (routine.frequency === 'monthly') {
                matches = targetDate.getDate() === startDate.getDate();
            } else if (routine.frequency === 'custom' && routine.interval) {
                const diffDays = Math.floor((targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                matches = diffDays >= 0 && diffDays % routine.interval === 0;
            }

            if (matches) {
                // Check if a task for this routine ALREADY EXISTS on this date (Open, Done, OR Skipped)
                const deterministicId = `routine-${routine.id}-${dateStr}`;
                // We check 'dbTasks' which includes skipped ones.
                const exists = dbTasks.some(t => t.id === deterministicId || t.routineId === routine.id);

                if (!exists) {
                    // Only generate virtual if NO entry exists in DB
                    virtualTasks.push({
                        id: deterministicId,
                        userId: routine.userId,
                        title: routine.title,
                        sectionId: routine.sectionId,
                        date: dateStr,
                        status: 'open',
                        estimatedMinutes: routine.estimatedMinutes,
                        actualMinutes: 0,
                        scheduledStart: routine.startTime,
                        order: 999,
                        projectId: routine.projectId,
                        routineId: routine.id,
                        tags: routine.tags,
                        memo: routine.memo
                    });
                }
            }
        });

        // 3. Return combined list, filtering out 'skipped' so they don't show in UI
        return [...dbTasks, ...virtualTasks].filter(t => t.status !== 'skipped');
    },

    user: null,
    setUser: (user) => {
        // Clean up previous subscription
        const { unsubscribe } = get();
        if (unsubscribe) {
            unsubscribe();
        }

        set({ user, unsubscribe: null });

        if (user) {
            // Track sub-subscriptions that need cleanup
            let unsubShared: (() => void) | null = null;
            let unsubProjects: (() => void) | null = null;


            // Subscribe Tasks
            // UNIFIED: Query global tasks collection where user is the owner
            const qTasks = query(collection(db, 'tasks'), where('userId', '==', user.uid));
            const unsubTasks = onSnapshot(qTasks, (snapshot) => {
                const tasks = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Task));
                set(state => {
                    // When personal tasks update, we need to re-merge with any existing shared tasks
                    // We can't easily get shared tasks here without storing them separately, 
                    // but for now, let's just update the stored tasks.
                    // Ideally, we should separate personalTasks and sharedTasks in store state to avoid this "re-fetching" issue.
                    // BUT, to fix the specific bug of "disappearing" tasks, the issue is likely in the Shared subscription overwriting this, or vice versa.

                    // Actually, the best way without major refactor is to keep them in sync.
                    // If we just set({ tasks }), we might wipe out shared tasks if they were verified.
                    // Let's rely on the fact that shared tasks subscription handles the merging usually.

                    // However, we need to be careful. If this fires, we have new personal tasks.
                    // We should probably keep existing shared tasks.
                    const currentShared = state.tasks.filter(t => t.projectId);
                    // Deduplicate tasks by ID
                    const combined = [...tasks, ...currentShared];
                    const unique = Array.from(new Map(combined.map(t => [t.id, t])).values());
                    return { tasks: unique };
                });
            }, (error) => handleFirestoreError(error, 'tasks'));

            // Subscribe Routines
            const qRoutines = query(collection(db, 'users', user.uid, 'routines'));
            const unsubRoutines = onSnapshot(qRoutines, (snapshot) => {
                const routines = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Routine));
                set({ routines });
            }, (error) => handleFirestoreError(error, 'routines'));

            // Subscribe Tags
            // UNIFIED: Query global tags collection where user is the owner
            const qTags = query(collection(db, 'tags'), where('userId', '==', user.uid));
            const unsubTags = onSnapshot(qTags, (snapshot) => {
                const tags = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Tag));
                set({ tags });
            }, (error) => handleFirestoreError(error, 'tags'));

            // Subscribe Projects (Global collection, filtered by membership)
            console.log("Subscribing to projects for user:", user.uid);
            const qProjects = query(
                collection(db, 'projects'),
                where('memberIds', 'array-contains', user.uid)
            );

            unsubProjects = onSnapshot(qProjects, (snapshot) => {
                console.log(`Projects snapshot: ${snapshot.size} projects found.`);
                const projects = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Project));
                set({ projects });

                // Subscribe Shared Tasks whenever project membership changes
                const projectIds = projects.map(p => p.id);

                // CRITICAL FIX: Clean up previous shared tasks subscriptions
                if (unsubShared) {
                    console.log("Cleaning up previous shared tasks subscriptions");
                    unsubShared();
                    unsubShared = null;
                }

                if (projectIds.length > 0) {
                    console.log("Subscribing to shared tasks for projects indivudally:", projectIds);

                    // Maintain a cache of tasks per project to aggregate updates
                    // This cache needs to be persistent across the multiple listeners below
                    const projectTasksCache: Record<string, Task[]> = {};
                    const unsubs: Unsubscribe[] = [];

                    const updateSharedTasksState = () => {
                        const allSharedTasks = Object.values(projectTasksCache).flat();
                        set(state => {
                            const personalTasks = state.tasks.filter(t => !t.projectId);
                            // Combine personal tasks and ALL shared tasks
                            // Deduplicate by ID
                            const combined = [...personalTasks, ...allSharedTasks];
                            const unique = Array.from(new Map(combined.map(t => [t.id, t])).values());
                            return { tasks: unique };
                        });
                    };

                    projectIds.forEach(projectId => {
                        const qProjectTasks = query(
                            collection(db, 'tasks'),
                            where('projectId', '==', projectId)
                        );

                        const unsub = onSnapshot(qProjectTasks, (snapshot) => {
                            const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
                            projectTasksCache[projectId] = tasks;
                            updateSharedTasksState();
                        }, (error) => handleFirestoreError(error, `project tasks ${projectId}`));
                        unsubs.push(unsub);
                    });

                    // Create a composite unsubscribe function
                    unsubShared = () => {
                        unsubs.forEach(u => u());
                    };
                } else {
                    // If no projects, ensure no shared tasks linger
                    set(state => {
                        const personalTasks = state.tasks.filter(t => !t.projectId);
                        return { tasks: personalTasks };
                    });
                }
            }, (error) => handleFirestoreError(error, 'projects'));

            // Subscribe Daily Notes
            const qNotes = query(collection(db, 'users', user.uid, 'dailyNotes'));
            const unsubNotes = onSnapshot(qNotes, (snapshot) => {
                const dailyNotes = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as DailyNote));
                set({ dailyNotes });
            }, (error) => handleFirestoreError(error, 'dailyNotes'));

            // Subscribe Weekly Notes
            const qWeeklyNotes = query(collection(db, 'users', user.uid, 'weeklyNotes'));
            // Use const here, as unsubWeeklyNotes is not reassigned
            const unsubWeeklyNotes = onSnapshot(qWeeklyNotes, (snapshot) => {
                const weeklyNotes = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as WeeklyNote));
                set({ weeklyNotes });
            }, (error) => handleFirestoreError(error, 'weeklyNotes'));

            // Subscribe Monthly Notes
            const qMonthlyNotes = query(collection(db, 'users', user.uid, 'monthlyNotes'));
            const unsubMonthlyNotes = onSnapshot(qMonthlyNotes, (snapshot) => {
                const monthlyNotes = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as MonthlyNote));
                set({ monthlyNotes });
            }, (error) => handleFirestoreError(error, 'monthlyNotes'));

            // Subscribe Sections
            const qSections = query(collection(db, 'users', user.uid, 'sections'));
            const unsubSections = onSnapshot(qSections, async (snapshot) => {
                if (snapshot.empty) {
                    // Check localStorage to avoid repeated onboarding attempts (Ad-blocker resilience)
                    const hasSeenOnboarding = localStorage.getItem('has_seen_onboarding');
                    if (hasSeenOnboarding) {
                        set({ sections: [] });
                        return;
                    }

                    // Mark as seen immediately to prevent loop
                    localStorage.setItem('has_seen_onboarding', 'true');

                    // Call Server-side Onboarding API (BFF Pattern)
                    try {
                        await fetch('/api/onboarding', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: user.uid })
                        });
                    } catch (error) {
                        console.error("Onboarding API failed:", error);
                    }
                    return;
                }
                const sections = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Section));
                // Sort by time or order
                sections.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.order - b.order);
                set({ sections });
            }, (error) => handleFirestoreError(error, 'sections'));

            // Register all unsubscriptions
            set({
                unsubscribe: () => {
                    console.log("Unsubscribing from all listeners");
                    unsubTasks();
                    unsubRoutines();
                    unsubTags();
                    unsubNotes();
                    if (unsubWeeklyNotes) unsubWeeklyNotes();
                    unsubSections();
                    if (unsubProjects) unsubProjects();
                    if (unsubShared) unsubShared();
                }
            });
        } else {
            // Revert to mock data or empty when logged out
            set({ tasks: [], routines: [], tags: [], sections: [] });
        }
    },

    // --- Tag Actions ---
    addTag: async (tag) => {
        const { user } = get();
        if (user) {
            try {
                // UNIFIED: Global 'tags' collection
                const ref = doc(collection(db, 'tags'), tag.id || undefined);
                await setDoc(ref, sanitizeData({
                    ...tag,
                    id: ref.id,
                    userId: user.uid
                }));
                return ref.id;
            } catch (error) {
                console.error("Error adding tag: ", error);
                return '';
            }
        }
        return '';
    },

    updateTag: async (tagId, updates) => {
        const { user } = get();
        if (user) {
            try {
                // UNIFIED: Global 'tags' collection
                const ref = doc(db, 'tags', tagId);
                await updateDoc(ref, sanitizeData(updates));
            } catch (error) {
                console.error("Error updating tag: ", error);
            }
        }
    },

    deleteTag: async (tagId) => {
        const { user } = get();
        if (user) {
            try {
                // UNIFIED: Global 'tags' collection
                const ref = doc(db, 'tags', tagId);
                await deleteDoc(ref);
            } catch (error) {
                console.error("Error deleting tag: ", error);
            }
        }
    },

    rebuildSections: async () => {
        const { user } = get();
        if (!user) return;

        // 1. Define Standard Sections
        const standards = [
            { name: 'Morning', startTime: '06:00', endTime: '09:00' },
            { name: 'Work', startTime: '09:00', endTime: '12:00' },
            { name: 'Afternoon', startTime: '13:00', endTime: '18:00' },
            { name: 'Night', startTime: '19:00', endTime: '22:00' }
        ];

        // 2. Generate Full List with Intervals
        const convertToMinutes = (timeStr: string) => {
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
        };
        const formatTime = (totalMinutes: number) => {
            const h = Math.floor(totalMinutes / 60);
            const m = totalMinutes % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        const newSections: Section[] = [];
        let currentMinutes = 0; // 00:00

        // Sort standards just in case
        standards.sort((a, b) => convertToMinutes(a.startTime) - convertToMinutes(b.startTime));

        for (const std of standards) {
            const startMins = convertToMinutes(std.startTime);
            const endMins = convertToMinutes(std.endTime);

            // Gap before?
            if (currentMinutes < startMins) {
                const startStr = formatTime(currentMinutes);
                const endStr = std.startTime;
                newSections.push({
                    id: `interval-${startStr}`,
                    userId: user.uid,
                    name: 'Interval',
                    startTime: startStr,
                    endTime: endStr,
                    order: newSections.length
                });
            }

            // Add Standard
            newSections.push({
                id: `section-${std.name.toLowerCase()}`,
                userId: user.uid,
                name: std.name,
                startTime: std.startTime,
                endTime: std.endTime,
                order: newSections.length
            });
            currentMinutes = endMins;
        }

        // Gap after last?
        if (currentMinutes < 24 * 60) {
            const startStr = formatTime(currentMinutes);
            // End of day
            newSections.push({
                id: `interval-${startStr}`,
                userId: user.uid,
                name: 'Interval',
                startTime: startStr,
                endTime: '24:00',
                order: newSections.length
            });
        }

        // 3. Batch Write to Firestore
        try {
            const batch = writeBatch(db);

            // Get existing sections to delete
            const q = query(collection(db, 'users', user.uid, 'sections'));
            const snapshot = await getDocs(q);
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });

            // Create new sections
            newSections.forEach(sec => {
                const ref = doc(collection(db, 'users', user.uid, 'sections'));
                batch.set(ref, sanitizeData({ ...sec, id: ref.id }));
            });

            await batch.commit();
            console.log("Sections rebuilt successfully.");

        } catch (e) {
            console.error("Error rebuilding sections:", e);
        }
    },

    saveDailyNote: async (date: string, content: string) => {
        const { user } = get();
        if (!user) return;
        const noteId = date;
        const noteRef = doc(db, 'users', user.uid, 'dailyNotes', noteId);
        try {
            await setDoc(noteRef, sanitizeData({
                id: noteId,
                userId: user.uid,
                content,
                updatedAt: Date.now()
            }), { merge: true });
        } catch (e) {
            console.error("Error saving daily note:", e);
        }
    },

    saveWeeklyNote: async (weekId: string, content: string) => {
        const { user } = get();
        if (!user) return;
        const noteRef = doc(db, 'users', user.uid, 'weeklyNotes', weekId);
        try {
            await setDoc(noteRef, sanitizeData({
                id: weekId,
                userId: user.uid,
                content,
                updatedAt: Date.now()
            }), { merge: true });
        } catch (e) {
            console.error("Error saving weekly note:", e);
        }
    },

    saveMonthlyNote: async (monthId: string, content: string) => {
        const { user } = get();
        await saveNoteGeneric('monthlyNotes', monthId, content, user, set, get);
    },

    saveYearlyNote: async (yearId: string, content: string) => {
        const { user } = get();
        await saveNoteGeneric('yearlyNotes', yearId, content, user, set, get);
    },

    toggleRightSidebar: () => set((state) => ({ isRightSidebarOpen: !state.isRightSidebarOpen })),
    toggleLeftSidebar: () => set((state) => ({ isLeftSidebarOpen: !state.isLeftSidebarOpen })),
    toggleDailyNoteModal: () => set((state) => ({ isDailyNoteModalOpen: !state.isDailyNoteModalOpen })),

    migrateTasks: async () => {
        const { user } = get();
        if (!user) return { success: false, message: 'Not logged in', count: 0 };

        try {
            const batch = writeBatch(db);
            let count = 0;

            // 1. Migrate Tasks from User Subcollection to Global Collection
            const privateTasksRef = collection(db, 'users', user.uid, 'tasks');
            const taskSnapshot = await getDocs(privateTasksRef);
            console.log(`Migrating ${taskSnapshot.size} tasks...`);

            if (!taskSnapshot.empty) {
                taskSnapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    const newRef = doc(db, 'tasks', docSnap.id);
                    batch.set(newRef, {
                        ...data,
                        id: docSnap.id,
                        userId: user.uid,
                        updatedAt: Date.now()
                    });
                    count++;
                });
            }

            if (count > 0) {
                await batch.commit();
            }
            return { success: true, message: `Migrated ${count} tasks`, count };
        } catch (error) {
            console.error("Migration failed", error);
            return { success: false, message: 'Migration failed', count: 0 };
        }
    }
}));
