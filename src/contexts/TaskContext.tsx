'use client';

import { createContext, useContext, ReactNode } from 'react';
import { Task } from '@/types';

interface TaskContextType {
    // Handler functions. Kept stable so task rows can skip rendering.
    onEdit: (task: Task) => void;
    canEdit: boolean;
    onToggleSelection: (id: string) => void;
    onPlay: (task: Task) => void;
    onStop: (task: Task) => void;
    onToggleStatus: (task: Task) => void;
    onTagClick: (tagId: string) => void;
    onImageClick: (url: string) => void;
}

const TaskContext = createContext<TaskContextType | undefined>(undefined);

export function TaskContextProvider({
    children,
    value
}: {
    children: ReactNode;
    value: TaskContextType
}) {
    return (
        <TaskContext.Provider value={value}>
            {children}
        </TaskContext.Provider>
    );
}

export function useTaskContext() {
    const context = useContext(TaskContext);
    if (!context) {
        throw new Error('useTaskContext must be used within TaskContextProvider');
    }
    return context;
}
