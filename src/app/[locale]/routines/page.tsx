'use client';

import { useState } from 'react';
import RoutineList from '@/components/RoutineList';
import RoutineModal from '@/components/RoutineModal';
import { Routine } from '@/types';
import { Plus, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import LeftSidebar from '@/components/LeftSidebar';
import PageHeader from '@/components/PageHeader';
import clsx from 'clsx';

export default function RoutinesPage() {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRoutine, setEditingRoutine] = useState<Routine | undefined>(undefined);

    const handleCreate = () => {
        setEditingRoutine(undefined);
        setIsModalOpen(true);
    };

    const handleEdit = (routine: Routine) => {
        setEditingRoutine(routine);
        setIsModalOpen(true);
    };

    return (
        <>
            <LeftSidebar />
            <PageHeader />
            <main className="min-h-screen bg-gray-50 p-4 sm:p-8 pt-4 md:pt-8">
                <div className="max-w-4xl mx-auto">
                    <div className="mb-6 flex items-center justify-between">
                        <div>
                            <Link href="/tasks" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-2">
                                <ChevronLeft size={16} /> Back to Tasks
                            </Link>
                            <h1 className="text-2xl font-bold text-gray-900">Routines</h1>
                            <p className="text-sm text-gray-500">Manage recurring tasks</p>
                        </div>
                        <button
                            onClick={handleCreate}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                        >
                            <Plus size={18} />
                            New Routine
                        </button>
                    </div>

                    <RoutineList onEdit={handleEdit} />

                    <RoutineModal
                        isOpen={isModalOpen}
                        onClose={() => setIsModalOpen(false)}
                        editRoutine={editingRoutine}
                    />
                </div>
            </main>
        </>
    );
}
