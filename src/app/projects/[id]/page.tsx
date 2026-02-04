'use client';

import { useStore } from '@/store/useStore';
import { useRouter } from 'next/navigation';
import { use, useState, useMemo } from 'react';
import { ArrowLeft, Clock, Plus, Trash2, Edit2, Play, Square, CheckSquare, ExternalLink, Users, Link as LinkIcon, Copy, Loader2, Check, X } from 'lucide-react';
import { Task, HubRole } from '@/types';
import clsx from 'clsx';
import AddTaskModal from '@/components/AddTaskModal';
import Link from 'next/link';

interface PageProps {
    params: Promise<{ id: string }>;
}

import LeftSidebar from '@/components/LeftSidebar';

import PageHeader from '@/components/PageHeader';

export default function ProjectDetailsPage({ params }: PageProps) {
    const { id: projectId } = use(params);
    const router = useRouter();
    const { user, projects, tasks, updateProject, deleteProject, updateTask, deleteTask, generateInviteLink } = useStore();

    const [isEditingDesc, setIsEditingDesc] = useState(false);
    const [editDesc, setEditDesc] = useState('');
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);
    const [taskToEdit, setTaskToEdit] = useState<Task | null>(null);
    const [isInviteOpen, setIsInviteOpen] = useState(false);
    const [inviteRole, setInviteRole] = useState<HubRole>('member');
    const [generatedLink, setGeneratedLink] = useState('');
    const [inviteStatus, setInviteStatus] = useState({ loading: false, message: '' });

    // Sort State
    type SortOption = 'score' | 'date' | 'order';
    const [sortBy, setSortBy] = useState<SortOption>('score');

    const handleGenerateLink = async () => {
        setInviteStatus({ loading: true, message: '' });
        const res = await generateInviteLink(projectId, undefined, inviteRole);
        setInviteStatus({ loading: false, message: res.message });
        if (res.success && res.joinLink) {
            setGeneratedLink(res.joinLink);
        }
    };

    const openEditTask = (task: Task) => {
        setTaskToEdit(task);
        setIsAddTaskOpen(true);
    };

    const handleDeleteTask = async (taskId: string) => {
        if (confirm('Delete this task?')) {
            await deleteTask(taskId);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        alert('Copied to clipboard!');
    };

    const project = projects.find(p => p.id === projectId);
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

    const userRole = useMemo(() => {
        if (!user || !project) return 'viewer';
        if (project.ownerId === user.uid) return 'owner';
        return project.roles?.[user.uid] || 'member';
    }, [user, project]);

    const canEditProject = ['owner', 'admin'].includes(userRole);
    const canManageTasks = ['owner', 'admin', 'member'].includes(userRole);
    const isOwner = userRole === 'owner';

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
                </div>

                {/* Invite Modal */}
                {isInviteOpen && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-95">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-lg font-bold flex items-center gap-2">
                                    <Users size={20} className="text-purple-600" />
                                    Invite Team Member
                                </h2>
                                <button onClick={() => { setIsInviteOpen(false); setGeneratedLink(''); }} className="text-gray-400 hover:text-gray-600">
                                    <Trash2 size={18} />
                                </button>
                            </div>

                            {!generatedLink ? (
                                <div className="space-y-4">
                                    <p className="text-sm text-gray-500">
                                        Choose a role and generate a unique invitation link to share with your team.
                                    </p>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Assigned Role</label>
                                        <select
                                            value={inviteRole}
                                            onChange={(e) => setInviteRole(e.target.value as HubRole)}
                                            className="w-full border border-gray-300 rounded-lg p-2 bg-white"
                                        >
                                            <option value="member">Member (Can edit tasks)</option>
                                            <option value="admin">Admin (Can manage project)</option>
                                            <option value="viewer">Viewer (Read-only)</option>
                                        </select>
                                    </div>
                                    <button
                                        onClick={handleGenerateLink}
                                        disabled={inviteStatus.loading}
                                        className="w-full py-2 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {inviteStatus.loading ? <Loader2 size={18} className="animate-spin" /> : <LinkIcon size={18} />}
                                        Generate Join Link
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg">
                                        <p className="text-xs text-purple-700 font-bold uppercase mb-1">Invitation Link</p>
                                        <div className="flex items-center gap-2">
                                            <input
                                                readOnly
                                                value={generatedLink}
                                                className="flex-1 bg-transparent text-sm text-purple-900 outline-none border-none pointer-events-none"
                                            />
                                            <button
                                                onClick={() => copyToClipboard(generatedLink)}
                                                className="p-1 hover:bg-purple-200 rounded text-purple-600 transition-colors"
                                            >
                                                <Copy size={16} />
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-gray-400">
                                        This link expires in 7 days. Shared with role: <span className="font-bold">{inviteRole}</span>
                                    </p>
                                    <button
                                        onClick={() => { setIsInviteOpen(false); setGeneratedLink(''); }}
                                        className="w-full py-2 bg-gray-100 text-gray-600 rounded-lg font-bold hover:bg-gray-200 transition-colors"
                                    >
                                        Done
                                    </button>
                                </div>
                            )}

                            {inviteStatus.message && !generatedLink && (
                                <p className="text-xs mt-2 text-red-600">{inviteStatus.message}</p>
                            )}
                        </div>
                    </div>
                )}

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
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                        <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                            <Users size={18} className="text-purple-600" />
                            Team Members
                        </h2>
                        <div className="space-y-3">
                            {project.memberIds.map(uid => (
                                <div key={uid} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-bold text-xs">
                                            {uid.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-gray-900">User ID: {uid.substring(0, 8)}...</p>
                                            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter">
                                                {project.roles?.[uid] || (uid === project.ownerId ? 'owner' : 'member')}
                                            </p>
                                        </div>
                                    </div>
                                    {isOwner && uid !== project.ownerId && (
                                        <button className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Tasks */}
                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="font-bold text-lg text-gray-800">Tasks</h2>
                            <div className="flex items-center gap-2">
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
                            {projectTasks.length === 0 ? (
                                <div className="text-center py-8 bg-white rounded-xl border border-dashed border-gray-200 text-gray-400">
                                    No tasks in this project yet.
                                </div>
                            ) : (
                                projectTasks.map(task => (
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
                />
            </div>
        </>
    );
}
