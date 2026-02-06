'use client';

import { useStore } from '@/store/useStore';
import { useRouter } from 'next/navigation';
import { use, useState, useMemo } from 'react';
import { ArrowLeft, Plus, Trash2, Edit2, Square, CheckSquare, Users, Link as LinkIcon, Copy, Loader2, Check, X, Calendar, BarChart2, Filter, LayoutList, Kanban, CheckCircle2, Clock } from 'lucide-react';
import { Task, HubRole, Milestone } from '@/types';
import clsx from 'clsx';
import AddTaskModal from '@/components/AddTaskModal';
import MilestoneModal from '@/components/MilestoneModal';
import MilestoneBoard from '@/components/MilestoneBoard'; // NEW
import LeftSidebar from '@/components/LeftSidebar';
import PageHeader from '@/components/PageHeader';

interface PageProps {
    params: Promise<{ id: string }>;
}

import ProjectInviteModal from '@/components/ProjectInviteModal';
import ProjectMembers from '@/components/ProjectMembers';

export default function ProjectDetailsPage({ params }: PageProps) {

    const { id: projectId } = use(params);
    const router = useRouter();
    const { user, projects, tasks, updateProject, deleteProject, updateTask, deleteTask } = useStore();

    const [isEditingDesc, setIsEditingDesc] = useState(false);
    const [editDesc, setEditDesc] = useState('');
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitle, setEditTitle] = useState('');

    // Task Modal State
    const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);
    const [taskToEdit, setTaskToEdit] = useState<Task | null>(null);

    // Invite Modal State (Just open/close now)
    const [isInviteOpen, setIsInviteOpen] = useState(false);

    // Milestone State
    const [isMilestoneModalOpen, setIsMilestoneModalOpen] = useState(false);
    const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
    const [filterMilestoneId, setFilterMilestoneId] = useState<string | null>(null);

    // Sort State
    type SortOption = 'score' | 'date' | 'order';
    type MilestoneViewMode = 'list' | 'board';
    const [sortBy, setSortBy] = useState<SortOption>('score');
    const [milestoneViewMode, setMilestoneViewMode] = useState<MilestoneViewMode>('list');

    // Data Load
    const project = projects.find(p => p.id === projectId);

    // Derived Data
    const projectTasks = useMemo(() => tasks.filter(t => t.projectId === projectId).sort((a, b) => {
        if (sortBy === 'score') {
            const scoreA = a.score || -1;
            const scoreB = b.score || -1;
            if (scoreA > 0 && scoreB > 0) return scoreB - scoreA;
            if (scoreA > 0 && scoreB <= 0) return -1;
            if (scoreA <= 0 && scoreB > 0) return 1;
            return a.order - b.order;
        } else if (sortBy === 'date') {
            if (a.date !== b.date) {
                return (a.date || '').localeCompare(b.date || '');
            }
        }
        return a.order - b.order;
    }), [tasks, projectId, sortBy]);

    // Role Check
    const userRole = useMemo(() => {
        if (!user || !project) return 'viewer';
        if (project.ownerId === user.uid) return 'owner';
        return project.roles?.[user.uid] || 'member';
    }, [user, project]);

    const canEditProject = ['owner', 'admin'].includes(userRole);
    const canManageTasks = ['owner', 'admin', 'member'].includes(userRole);
    const isOwner = userRole === 'owner';

    // Milestone Logic
    const milestones = useMemo(() => {
        return (project?.milestones || []).sort((a, b) => {
            if (a.startDate && b.startDate) return a.startDate.localeCompare(b.startDate);
            return a.order - b.order;
        });
    }, [project?.milestones]);

    // Task Filter Logic
    const filteredTasks = useMemo(() => {
        if (!filterMilestoneId) return projectTasks;
        if (filterMilestoneId === 'uncategorized') return projectTasks.filter(t => !t.milestoneId);
        return projectTasks.filter(t => t.milestoneId === filterMilestoneId);
    }, [projectTasks, filterMilestoneId]);

    if (!project) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <p className="text-gray-500 mb-4">Project not found</p>
                    <button onClick={() => router.push('/projects')} className="text-blue-600 hover:underline">Return to list</button>
                </div>
            </div>
        );
    }

    // Handlers
    const openEditTask = (task: Task) => {
        setTaskToEdit(task);
        setIsAddTaskOpen(true);
    };

    const handleDeleteTask = async (taskId: string) => {
        if (confirm('Delete this task?')) {
            await deleteTask(taskId);
        }
    };

    const handleSaveDesc = async () => {
        await updateProject(projectId, { description: editDesc });
        setIsEditingDesc(false);
    };

    const handleSaveTitle = async () => {
        if (!editTitle.trim()) return;
        await updateProject(projectId, { title: editTitle });
        setIsEditingTitle(false);
    };

    const startEditingTitle = () => {
        setEditTitle(project.title);
        setIsEditingTitle(true);
    };

    const startEditing = () => {
        setEditDesc(project.description);
        setIsEditingDesc(true);
    };

    const handleDeleteProject = async () => {
        if (confirm('Delete this project? Linked tasks will remain but lose project association.')) {
            await deleteProject(projectId);
            router.push('/projects');
        }
    };

    // Milestone Handlers
    const handleSaveMilestone = async (data: any) => {
        const newMilestones = [...(project.milestones || [])];
        if (data.id) {
            const idx = newMilestones.findIndex(m => m.id === data.id);
            if (idx >= 0) newMilestones[idx] = { ...newMilestones[idx], ...data };
        } else {
            newMilestones.push({ ...data, id: crypto.randomUUID(), order: newMilestones.length });
        }
        await updateProject(projectId, { milestones: newMilestones });
    };

    const handleMilestoneUpdate = async (id: string, updates: Partial<Milestone>) => {
        if (!project || !project.milestones) return;
        const updatedMilestones = project.milestones.map(m => m.id === id ? { ...m, ...updates } : m);
        await updateProject(project.id, { milestones: updatedMilestones });
    };

    const handleDeleteMilestone = async (milestoneId: string) => {
        if (confirm('Delete this schedule? Tasks will remain but lose schedule association.')) {
            const newMilestones = (project.milestones || []).filter(m => m.id !== milestoneId);
            await updateProject(projectId, { milestones: newMilestones });
            if (filterMilestoneId === milestoneId) setFilterMilestoneId(null);
        }
    };

    const handleOpenMilestoneModal = (milestone?: Milestone) => {
        setEditingMilestone(milestone || null);
        setIsMilestoneModalOpen(true);
    };

    // Calculate progress
    const totalTasks = projectTasks.length;
    const completedTasks = projectTasks.filter(t => t.status === 'done').length;
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return (
        <>
            <LeftSidebar />
            <PageHeader />
            <div className="min-h-screen bg-gray-50 text-gray-900 pb-20 pt-4 md:pt-0">
                {/* Content Header */}
                <div className="max-w-4xl mx-auto px-4 py-8 md:px-8 pb-0 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <button onClick={() => router.push('/projects')} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            {isEditingTitle ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        value={editTitle}
                                        onChange={(e) => setEditTitle(e.target.value)}
                                        className="text-xl font-bold border rounded px-2 py-1 outline-none ring-2 ring-blue-500/20 focus:ring-blue-500 text-gray-900"
                                        autoFocus
                                    />
                                    <button onClick={handleSaveTitle} className="p-1.5 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors">
                                        <Check size={18} />
                                    </button>
                                    <button onClick={() => setIsEditingTitle(false)} className="p-1.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors">
                                        <X size={18} />
                                    </button>
                                </div>
                            ) : (
                                <h1 className="text-xl font-bold flex items-center gap-2 group">
                                    {project.title}
                                    {canEditProject && (
                                        <button
                                            onClick={startEditingTitle}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-blue-600 rounded"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                    )}
                                    <span className={clsx("text-xs px-2 py-0.5 rounded-full border ml-2",
                                        project.status === 'active' ? "bg-blue-50 text-blue-700 border-blue-200" :
                                            project.status === 'completed' ? "bg-green-50 text-green-700 border-green-200" :
                                                "bg-gray-100 text-gray-600 border-gray-200"
                                    )}>{project.status}</span>
                                </h1>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {canEditProject && (
                            <button
                                onClick={() => setIsInviteOpen(true)}
                                className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                            >
                                <Users size={18} />
                                <span className="hidden sm:inline">Invite</span>
                            </button>
                        )}
                        {isOwner && (
                            <button
                                onClick={handleDeleteProject}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="Delete Project"
                            >
                                <Trash2 size={18} />
                            </button>
                        )}
                    </div>
                </div >

                <ProjectInviteModal
                    isOpen={isInviteOpen}
                    onClose={() => setIsInviteOpen(false)}
                    projectId={projectId}
                    existingMemberIds={project.memberIds}
                />

                <div className="max-w-4xl mx-auto px-4 py-8 md:px-8 space-y-8">

                    {/* Description & Stats */}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                        <div className="flex justify-between items-start mb-4">
                            <h2 className="font-semibold text-gray-700">Description</h2>
                            {!isEditingDesc && canEditProject && (
                                <button onClick={startEditing} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                                    <Edit2 size={14} /> Edit
                                </button>
                            )}
                        </div>

                        {isEditingDesc ? (
                            <div className="space-y-2">
                                <textarea
                                    value={editDesc}
                                    onChange={e => setEditDesc(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg p-3 min-h-[150px] focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="# Goals..."
                                />
                                <div className="flex justify-end gap-2">
                                    <button onClick={() => setIsEditingDesc(false)} className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                                    <button onClick={handleSaveDesc} className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                                </div>
                            </div>
                        ) : (
                            <div className="prose prose-sm max-w-none text-gray-600 whitespace-pre-wrap">
                                {project.description || <span className="text-gray-400 italic">No description provided.</span>}
                            </div>
                        )}

                        <div className="mt-6 pt-6 border-t border-gray-100 grid grid-cols-3 gap-4 text-center">
                            <div>
                                <div className="text-2xl font-bold text-gray-900">{totalTasks}</div>
                                <div className="text-xs text-gray-500 uppercase tracking-wider">Total Tasks</div>
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-green-600">{completedTasks}</div>
                                <div className="text-xs text-gray-500 uppercase tracking-wider">Completed</div>
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-blue-600">{progress}%</div>
                                <div className="text-xs text-gray-500 uppercase tracking-wider">Progress</div>
                            </div>
                        </div>
                    </div>

                    {/* Team Members */}
                    <ProjectMembers
                        project={project}
                        currentUserRole={userRole}
                        currentUserId={user?.uid || ''}
                    />

                    {/* Milestones Section - Conditional Render */}
                    {((project.milestones && project.milestones.length > 0) || canEditProject) && (
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-8">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="font-semibold text-gray-700 flex items-center gap-2">
                                    <Calendar size={18} className="text-blue-600" />
                                    Schedule
                                </h2>

                                <div className="flex items-center gap-2">
                                    <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
                                        <button
                                            onClick={() => setMilestoneViewMode('list')}
                                            className={clsx(
                                                "p-1 rounded transition-colors",
                                                milestoneViewMode === 'list' ? "bg-white text-blue-600 shadow-sm" : "text-gray-400 hover:text-gray-600"
                                            )}
                                            title="List View"
                                        >
                                            <LayoutList size={16} />
                                        </button>
                                        <button
                                            onClick={() => setMilestoneViewMode('board')}
                                            className={clsx(
                                                "p-1 rounded transition-colors",
                                                milestoneViewMode === 'board' ? "bg-white text-blue-600 shadow-sm" : "text-gray-400 hover:text-gray-600"
                                            )}
                                            title="Board View"
                                        >
                                            <Kanban size={16} />
                                        </button>
                                    </div>

                                    {canManageTasks && (
                                        <button
                                            onClick={() => handleOpenMilestoneModal()}
                                            className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                                        >
                                            <Plus size={16} /> Add
                                        </button>
                                    )}
                                </div>
                            </div>

                            {milestoneViewMode === 'board' ? (
                                <MilestoneBoard
                                    milestones={milestones}
                                    onUpdateMilestone={handleMilestoneUpdate}
                                    onEditMilestone={handleOpenMilestoneModal}
                                    onDeleteMilestone={handleDeleteMilestone}
                                    onMilestoneClick={(id) => setFilterMilestoneId(filterMilestoneId === id ? null : id)}
                                    selectedMilestoneId={filterMilestoneId}
                                />
                            ) : (
                                <div className="space-y-3">
                                    {milestones.length === 0 ? (
                                        <div className="text-center py-6 text-gray-400 text-sm italic">
                                            No schedules set.
                                        </div>
                                    ) : (
                                        milestones.map(milestone => {
                                            // Calculate progress
                                            const tasksInMilestone = projectTasks.filter(t => t.milestoneId === milestone.id);
                                            const total = tasksInMilestone.length;
                                            const completed = tasksInMilestone.filter(t => t.status === 'done').length;
                                            const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

                                            return (
                                                <div
                                                    key={milestone.id}
                                                    className={clsx(
                                                        "border rounded-lg p-4 cursor-pointer transition-all hover:shadow-md",
                                                        filterMilestoneId === milestone.id
                                                            ? "bg-blue-50 border-blue-200 ring-1 ring-blue-300 transform scale-[1.01]"
                                                            : "bg-white border-gray-200 hover:border-blue-200"
                                                    )}
                                                    onClick={() => setFilterMilestoneId(filterMilestoneId === milestone.id ? null : milestone.id)}
                                                >
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div>
                                                            <h3 className="font-medium text-gray-900 flex items-center gap-2">
                                                                {milestone.title}
                                                                {milestone.status === 'done' && <CheckCircle2 size={14} className="text-green-500" />}
                                                            </h3>
                                                            <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                                                                {(milestone.startDate || milestone.endDate) ? (
                                                                    <span>{milestone.startDate ? new Date(milestone.startDate).toLocaleDateString() : 'Start'} - {milestone.endDate ? new Date(milestone.endDate).toLocaleDateString() : 'End'}</span>

                                                                ) : (
                                                                    <span className="italic text-gray-400">No date set</span>
                                                                )}
                                                            </div>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                {milestone.status === 'done' ? (
                                                                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                                        <CheckCircle2 size={12} /> Done
                                                                    </span>
                                                                ) : milestone.status === 'in_progress' ? (
                                                                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                                        <Clock size={12} /> Doing
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                                        <Square size={12} /> To Do
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            {(canManageTasks && (filterMilestoneId === milestone.id)) && (
                                                                <div className="flex gap-1 bg-white/50 rounded-lg p-1" onClick={(e) => e.stopPropagation()}>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleOpenMilestoneModal(milestone); }}
                                                                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-white rounded transition-colors"
                                                                    >
                                                                        <Edit2 size={14} />
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            if (confirm('Are you sure? Tasks will be unconnected.')) handleDeleteMilestone(milestone.id);
                                                                        }}
                                                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-white rounded transition-colors"
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Progress Bar */}
                                                    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-3 overflow-hidden">
                                                        <div
                                                            className={clsx("h-1.5 rounded-full transition-all duration-500",
                                                                progress === 100 ? "bg-green-500" : "bg-blue-500"
                                                            )}
                                                            style={{ width: `${progress}%` }}
                                                        ></div>
                                                    </div>
                                                    <div className="flex justify-end mt-1">
                                                        <span className="text-[10px] text-gray-400 font-medium">{completed}/{total}</span>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Tasks */}
                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="font-bold text-lg text-gray-800">Tasks</h2>
                            <div className="flex items-center gap-2">
                                {/* Filter Dropdown */}
                                {(milestones.length > 0) && (
                                    <div className="relative flex items-center">
                                        <Filter size={16} className="absolute left-2 text-gray-400 pointer-events-none" />
                                        <select
                                            value={filterMilestoneId || ''}
                                            onChange={(e) => setFilterMilestoneId(e.target.value || null)}
                                            className={clsx(
                                                "pl-8 pr-4 py-1.5 text-xs border rounded-lg focus:outline-none focus:border-blue-400 appearance-none cursor-pointer font-medium max-w-[150px] truncate",
                                                filterMilestoneId ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-gray-200 text-gray-700"
                                            )}
                                        >
                                            <option value="">All Schedules</option>
                                            <option value="uncategorized">Uncategorized</option>
                                            <hr />
                                            {milestones.map(m => (
                                                <option key={m.id} value={m.id}>{m.title}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <select
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                                    className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white appearance-none cursor-pointer text-gray-700 font-medium"
                                >
                                    <option value="score">Score (High-Low)</option>
                                    <option value="date">Date (Oldest)</option>
                                    <option value="order">Manual Order</option>
                                </select>

                                {canManageTasks && (
                                    <button
                                        onClick={() => setIsAddTaskOpen(true)}
                                        className="flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                                    >
                                        <Plus size={16} />
                                        Add Task
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            {filteredTasks.length === 0 ? (
                                <div className="text-center py-8 bg-white rounded-xl border border-dashed border-gray-200 text-gray-400">
                                    {filterMilestoneId ? "No tasks in this schedule." : "No tasks in this project yet."}
                                </div>
                            ) : (
                                filteredTasks.map(task => (
                                    <div key={task.id} className={clsx(
                                        "group bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between hover:shadow-sm transition-shadow",
                                        task.status === 'done' && "bg-gray-50"
                                    )}>
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => updateTask(task.id, { status: task.status === 'done' ? 'open' : 'done' })}
                                                className={clsx("transition-colors", task.status === 'done' ? "text-green-500" : "text-gray-300 hover:text-gray-400")}
                                            >
                                                {task.status === 'done' ? <CheckSquare size={20} /> : <Square size={20} />}
                                            </button>
                                            <div className={clsx(task.status === 'done' && "line-through text-gray-400")}>
                                                <span className="font-medium">{task.title}</span>
                                                {task.scheduledStart && <span className="ml-2 text-xs text-gray-400 font-mono bg-gray-100 px-1 rounded">{task.scheduledStart}</span>}
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-400 flex items-center gap-2">
                                            {/* Show Milestone Badge if not filtered by it */}
                                            {(!filterMilestoneId && task.milestoneId) && (
                                                <span className="bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded border border-orange-100 truncate max-w-[100px]">
                                                    {milestones.find(m => m.id === task.milestoneId)?.title || 'Schedule'}
                                                </span>
                                            )}

                                            {task.status !== 'done' && <span>{task.estimatedMinutes} min</span>}
                                            {task.date && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{new Date(task.date).toLocaleDateString()}</span>}

                                            <div className="flex gap-1 ml-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); openEditTask(task); }}
                                                    className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-blue-600"
                                                    title="Edit"
                                                >
                                                    <Edit2 size={14} />
                                                </button>
                                                {canManageTasks && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                                                        className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                <AddTaskModal
                    isOpen={isAddTaskOpen}
                    onClose={() => {
                        setIsAddTaskOpen(false);
                        setTaskToEdit(null);
                    }}
                    initialProjectId={projectId}
                    taskToEdit={taskToEdit}
                    {...(filterMilestoneId && filterMilestoneId !== 'uncategorized' ? { initialMilestoneId: filterMilestoneId } : {})}
                />

                <MilestoneModal
                    isOpen={isMilestoneModalOpen}
                    onClose={() => setIsMilestoneModalOpen(false)}
                    onSubmit={handleSaveMilestone}
                    initialMilestone={editingMilestone}
                />
            </div >
        </>
    );
}
