'use client';

import type { Dispatch, SetStateAction } from 'react';

import type { Project } from '@/types';

type TaskType = 'task' | 'daily' | 'weekly' | 'monthly' | 'yearly';

interface TaskFormProps {
    title: string;
    setTitle: Dispatch<SetStateAction<string>>;
    activeType: TaskType;
    projectId: string;
    setProjectId: Dispatch<SetStateAction<string>>;
    milestoneId: string;
    setMilestoneId: Dispatch<SetStateAction<string>>;
    projects: Project[];
    memo: string;
    setMemo: Dispatch<SetStateAction<string>>;
}

export function TaskForm({
    title,
    setTitle,
    activeType,
    projectId,
    setProjectId,
    milestoneId,
    setMilestoneId,
    projects,
    memo,
    setMemo,
}: TaskFormProps) {
    const selectedProject = projects.find((project) => project.id === projectId);

    return (
        <>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                    placeholder={activeType === 'task' ? "e.g., Check emails" : `e.g., ${activeType} Goal`}
                    autoFocus
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project (Optional)</label>
                <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white text-gray-900"
                >
                    <option value="">No Project</option>
                    {projects.filter((project) => project.status === 'active' || project.id === projectId).map((project) => (
                        <option key={project.id} value={project.id}>
                            {project.title}
                        </option>
                    ))}
                </select>
            </div>

            {selectedProject?.milestones && selectedProject.milestones.length > 0 && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Schedule</label>
                    <select
                        value={milestoneId}
                        onChange={(e) => setMilestoneId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white text-gray-900"
                    >
                        <option value="">No Schedule</option>
                        {selectedProject.milestones.map((milestone) => (
                            <option key={milestone.id} value={milestone.id}>
                                {milestone.title}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Memo (Markdown)</label>
                <textarea
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 min-h-[100px] font-mono text-sm"
                    placeholder="Add notes, meeting minutes..."
                />
            </div>
        </>
    );
}
