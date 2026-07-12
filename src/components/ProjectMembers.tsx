import { useEffect, useState } from 'react';
import { Users, Trash2 } from 'lucide-react';
import { Project } from '@/types';
import { createClient } from '@/lib/supabase/client';

interface ProjectMembersProps {
    project: Project;
    currentUserRole: string;
    currentUserId: string;
}

interface UserData {
    uid: string;
    displayName: string | null;
    email: string | null;
    photoURL: string | null;
}

export default function ProjectMembers({ project, currentUserRole, currentUserId }: ProjectMembersProps) {
    const [members, setMembers] = useState<UserData[]>([]);

    // Fetch Member Data
    useEffect(() => {
        const fetchMembers = async () => {
            if (!project.memberIds) return;
            const { data, error } = await createClient()
                .from('profiles')
                .select('*')
                .in('id', project.memberIds);

            if (error || !data) {
                setMembers(project.memberIds.map((uid) => ({ uid, displayName: 'Error Loading', email: null, photoURL: null })));
                return;
            }

            const map = new Map(data.map((profile) => [profile.id, profile]));
            setMembers(project.memberIds.map((uid) => {
                const profile = map.get(uid);
                return {
                    uid,
                    displayName: profile?.display_name ?? 'Unknown User',
                    email: profile?.email ?? null,
                    photoURL: profile?.avatar_url ?? null,
                };
            }));
        };
        fetchMembers();
    }, [project.memberIds]);

    const handleRemoveMember = async (uid: string) => {
        if (!confirm('Remove this member from the project?')) return;
        const { error } = await createClient()
            .from('project_members')
            .delete()
            .eq('project_id', project.id)
            .eq('user_id', uid);
        if (error) {
            console.error('Failed to remove project member:', error);
        }
    };

    const isOwner = currentUserRole === 'owner';

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Users size={18} className="text-purple-600" />
                Team Members
            </h2>
            <div className="space-y-3">
                {members.map(member => (
                    <div key={member.uid} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-bold text-xs overflow-hidden border border-gray-200">
                                {member.photoURL ? (
                                    <img src={member.photoURL} alt={member.displayName || ''} className="w-full h-full object-cover" />
                                ) : (
                                    (member.displayName || member.email || 'U').substring(0, 2).toUpperCase()
                                )}
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-900 leading-tight">
                                    {member.displayName || 'Unnamed User'}
                                </p>
                                <p className="text-xs text-gray-500">
                                    {member.email || `ID: ${member.uid.substring(0, 6)}...`}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter bg-gray-50 px-2 py-0.5 rounded">
                                {project.roles?.[member.uid] || (member.uid === project.ownerId ? 'owner' : 'member')}
                            </span>

                            {isOwner && member.uid !== project.ownerId && (
                                <button
                                    onClick={() => handleRemoveMember(member.uid)}
                                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                    title="Remove User"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                ))}

                {members.length === 0 && (
                    <div className="text-sm text-gray-400 italic">Loading members...</div>
                )}
            </div>
        </div>
    );
}
