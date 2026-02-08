export type TaskStatus = 'open' | 'in_progress' | 'done' | 'skipped';

export type HubRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface Task {
    id: string;
    userId: string;
    title: string;
    assigneeId?: string; // NEW: User assigned to the task
    reporterId?: string; // NEW: User who created the task (if different from userId/owner)
    sectionId: string;
    date: string;
    status: TaskStatus;
    estimatedMinutes: number;
    actualMinutes: number;
    startedAt?: number; // timestamp
    completedAt?: number; // timestamp
    scheduledStart?: string; // HH:mm
    externalLink?: string;
    projectId?: string; // NEW: Link to Project
    milestoneId?: string; // NEW: Link to Project Milestone
    routineId?: string; // NEW: Link to source Routine (for virtual task matching)
    assignedWeek?: string; // NEW: YYYY-Www for Weekly Goals
    assignedMonth?: string; // NEW: YYYY-MM for Monthly Goals
    assignedYear?: string; // NEW: YYYY for Yearly Goals
    assignedDate?: string; // NEW: YYYY-MM-DD for Daily Goals
    score?: number; // Priority Score
    order: number;
    tags?: string[];
    memo?: string;
    attachments?: Attachment[];
    createdAt?: number;
    updatedAt?: number;
}

export interface WeeklyNote {
    id: string; // YYYY-Www
    userId: string;
    content: string; // Markdown
    updatedAt: number;
}

export interface MonthlyNote {
    id: string; // YYYY-MM
    userId: string;
    content: string; // Markdown
    updatedAt: number;
}

export interface YearlyNote {
    id: string; // YYYY
    userId: string;
    content: string; // Markdown
    updatedAt: number;
}

export interface Attachment {
    id: string;
    url: string;
    path: string; // Storage path for deletion
    name: string;
    type: 'image' | 'file';
    size?: number; // bytes
    createdAt: number;
}

export interface Section {
    id: string;
    userId: string;
    name: string;
    startTime?: string; // HH:mm
    endTime?: string; // HH:mm (Optional, defines explicit end. If missing, extends to next section)
    order: number;
}

export interface Project {
    id: string;
    userId: string;
    title: string;
    description: string; // Markdown
    ownerId: string; // NEW: Project owner
    memberIds: string[]; // NEW: List of user IDs with access
    roles?: { [userId: string]: HubRole }; // NEW: Mapping of user IDs to their roles
    status: 'active' | 'completed' | 'archived';
    createdAt: number;
    updatedAt: number;
    milestones?: Milestone[];
}

export interface Milestone {
    id: string;
    title: string;
    description?: string;
    startDate?: string; // YYYY-MM-DD
    endDate?: string; // YYYY-MM-DD
    order: number;
    status: 'open' | 'in_progress' | 'done'; // NEW
}

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'custom';

export interface Routine {
    id: string;
    userId: string;
    title: string;
    frequency: Frequency;
    daysOfWeek?: number[]; // 0=Sun, 1=Mon...
    interval?: number; // For custom interval
    startDate: string; // YYYY-MM-DD (When the routine begins)
    nextRun: string; // YYYY-MM-DD (Legacy, but kept for sync logic if needed)
    startTime?: string; // HH:mm
    sectionId: string;
    estimatedMinutes: number;
    active: boolean;
    projectId?: string; // NEW
    tags?: string[]; // NEW
    memo?: string; // NEW
}

export interface Tag {
    id: string;
    userId: string;
    name: string;
    memo?: string;
    color?: string;
}


export interface DailyNote {
    id: string; // YYYY-MM-DD
    userId: string;
    content: string; // Markdown
    updatedAt: number;
}

export interface Invitation {
    id: string;
    projectId: string;
    email?: string;
    role: HubRole;
    inviterId: string;
    status: 'pending' | 'accepted' | 'expired';
    createdAt: number;
    expiresAt: number;
    isReusable?: boolean; // NEW: track if it's a reusable link
}
