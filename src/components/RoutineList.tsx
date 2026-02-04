'use client';

import { useStore } from '@/store/useStore';
import { Routine } from '@/types';
import { Edit2, Trash2, Calendar, Clock, Repeat } from 'lucide-react';

interface RoutineListProps {
    onEdit: (routine: Routine) => void;
}

export default function RoutineList({ onEdit }: RoutineListProps) {
    const { routines, deleteRoutine, updateRoutine } = useStore();

    if (routines.length === 0) {
        return (
            <div className="text-center py-12 bg-white rounded-xl shadow-sm">
                <p className="text-gray-500">No routines yet. Create one to automate your tasks!</p>
            </div>
        );
    }

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this routine?')) {
            await deleteRoutine(id);
        }
    };

    const toggleActive = async (routine: Routine) => {
        await updateRoutine(routine.id, { active: !routine.active });
    };

    return (
        <div className="space-y-4">
            {routines.map((routine) => (
                <div
                    key={routine.id}
                    className={`bg-white p-4 rounded-xl shadow-sm border transition-colors ${routine.active ? 'border-gray-200' : 'border-gray-100 bg-gray-50 opacity-75'
                        }`}
                >
                    <div className="flex items-start justify-between mb-2">
                        <div>
                            <h3 className={`font-bold text-gray-800 ${!routine.active && 'text-gray-500 line-through'}`}>
                                {routine.title}
                            </h3>
                            <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                                <span className="flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded">
                                    <Repeat size={12} />
                                    {routine.frequency === 'daily' && 'Daily'}
                                    {routine.frequency === 'weekly' && 'Weekly'}
                                    {routine.frequency === 'monthly' && 'Monthly'}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Calendar size={12} />
                                    Next: {routine.nextRun}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Clock size={12} />
                                    {routine.estimatedMinutes} min
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={routine.active}
                                    onChange={() => toggleActive(routine)}
                                />
                                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                        </div>
                    </div>

                    {routine.frequency === 'weekly' && routine.daysOfWeek && (
                        <div className="flex gap-1 mb-3">
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                                <span
                                    key={i}
                                    className={`text-[10px] w-5 h-5 flex items-center justify-center rounded-full ${routine.daysOfWeek!.includes(i) ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-300'
                                        }`}
                                >
                                    {day}
                                </span>
                            ))}
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2 border-t border-gray-50">
                        <button
                            onClick={() => onEdit(routine)}
                            className="text-gray-500 hover:text-blue-600 p-1.5 hover:bg-blue-50 rounded transition-colors"
                        >
                            <Edit2 size={16} />
                        </button>
                        <button
                            onClick={() => handleDelete(routine.id)}
                            className="text-gray-500 hover:text-red-600 p-1.5 hover:bg-red-50 rounded transition-colors"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
