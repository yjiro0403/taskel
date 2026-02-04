'use client';

import { useStore } from '@/store/useStore';
import { useState } from 'react';
import Link from 'next/link';
import { Plus, Folder, Clock, CheckCircle, Trash2, Edit2, Archive } from 'lucide-react';
import { Project } from '@/types';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';

import LeftSidebar from '@/components/LeftSidebar';

import PageHeader from '@/components/PageHeader';

export default function ProjectsPage() {
    const { projects, addProject, deleteProject, updateProject } = useStore();
    const router = useRouter();

    const [isCreating, setIsCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [filter, setFilter] = useState<'active' | 'completed' | 'archived'>('active');

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTitle.trim()) return;

        await addProject({
            id: crypto.randomUUID(),
            userId: '', // Handled by backend/store
            title: newTitle,
            description: newDesc,
            status: 'active',
            createdAt: Date.now(),
            updatedAt: Date.now()
        });

        setIsCreating(false);
        setNewTitle('');
        setNewDesc('');
    };

    const handleStatusChange = async (project: Project, status: Project['status']) => {
        await updateProject(project.id, { status });
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure? Tasks linked to this project will remain but lose their project association.')) {
            await deleteProject(id);
        }
    };

    const filteredProjects = projects
        .filter(p => p.status === filter)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return (
        <>
            <LeftSidebar />
            <PageHeader />
            <div className="min-h-screen bg-gray-50 text-gray-900 pb-20 pt-4 md:pt-0">
                <div className="max-w-5xl mx-auto px-4 py-8 md:px-8">
                    {/* Header Controls */}
                    <div className="flex justify-between items-center mb-8">
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Folder className="text-blue-600" />
                            Projects
                        </h1>
                        <div className="flex gap-2">
                            <Link href="/tasks" className="hidden sm:flex items-center gap-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-4 py-2 rounded-lg transition-colors font-medium">
                                Back to Home
                            </Link>
                            <button
                                onClick={() => setIsCreating(true)}
                                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium shadow-sm"
                            >
                                <Plus size={20} />
                                <span className="hidden sm:inline">New Project</span>
                            </button>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex gap-2 mb-6">
                        {(['active', 'completed', 'archived'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={clsx(
                                    "px-4 py-2 rounded-full text-sm font-medium transition-colors capitalize",
                                    filter === f
                                        ? "bg-blue-100 text-blue-700"
                                        : "text-gray-500 hover:bg-gray-100"
                                )}
                            >
                                {f}
                            </button>
                        ))}
                    </div>

                    {/* Create Modal/Form */}
                    {isCreating && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 animate-in zoom-in-95">
                                <h2 className="text-lg font-bold mb-4">Create New Project</h2>
                                <form onSubmit={handleCreate} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                                        <input
                                            type="text"
                                            value={newTitle}
                                            onChange={e => setNewTitle(e.target.value)}
                                            className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            placeholder="Project Name"
                                            autoFocus
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Description (Markdown)</label>
                                        <textarea
                                            value={newDesc}
                                            onChange={e => setNewDesc(e.target.value)}
                                            className="w-full border border-gray-300 rounded-lg p-2 h-32 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            placeholder="# Goals\n- Item 1"
                                        />
                                    </div>
                                    <div className="flex justify-end gap-2 pt-2">
                                        <button
                                            type="button"
                                            onClick={() => setIsCreating(false)}
                                            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                            disabled={!newTitle.trim()}
                                        >
                                            Create Project
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}

                    {/* List */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredProjects.map(project => (
                            <div key={project.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow group flex flex-col">
                                <div className="p-5 flex-1 cursor-pointer" onClick={() => router.push(`/projects/${project.id}`)}>
                                    <div className="flex justify-between items-start mb-2">
                                        <h3 className="font-bold text-lg text-gray-900 line-clamp-2">{project.title}</h3>
                                        {project.status === 'completed' && <CheckCircle size={18} className="text-green-500 shrink-0" />}
                                        {project.status === 'archived' && <Archive size={18} className="text-gray-400 shrink-0" />}
                                    </div>
                                    <p className="text-gray-500 text-sm line-clamp-3 mb-4 h-12">
                                        {project.description || "No description"}
                                    </p>
                                    <div className="text-xs text-gray-400 flex gap-2">
                                        <Clock size={14} />
                                        <span>Updated {new Date(project.updatedAt).toLocaleDateString()}</span>
                                    </div>
                                </div>

                                {/* Actions Footer */}
                                <div className="border-t border-gray-100 p-3 flex justify-end gap-2 bg-gray-50/50 rounded-b-xl">
                                    {project.status !== 'active' ? (
                                        <button
                                            onClick={() => handleStatusChange(project, 'active')}
                                            className="text-sm text-blue-600 hover:bg-blue-50 px-2 py-1 rounded"
                                        >
                                            Reopen
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => handleStatusChange(project, 'completed')}
                                            className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                                            title="Mark Complete"
                                        >
                                            <CheckCircle size={18} />
                                        </button>
                                    )}

                                    <button
                                        onClick={() => router.push(`/projects/${project.id}`)}
                                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                        title="Edit / View"
                                    >
                                        <Edit2 size={18} />
                                    </button>

                                    <button
                                        onClick={() => handleDelete(project.id)}
                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                        title="Delete"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}

                        {filteredProjects.length === 0 && (
                            <div className="col-span-full py-12 text-center text-gray-400 bg-white rounded-xl border border-dashed border-gray-200">
                                <Folder size={48} className="mx-auto mb-4 opacity-20" />
                                <p>No {filter} projects found.</p>
                                {filter === 'active' && (
                                    <button onClick={() => setIsCreating(true)} className="text-blue-600 hover:underline mt-2">Create one?</button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
