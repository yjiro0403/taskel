import { useEffect, useState } from 'react';
import { Users, Trash2 } from 'lucide-react';
import { Project } from '@/types';
import { auth } from '@/lib/firebase';
import { useStore } from '@/store/useStore';

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
    const { updateProject } = useStore();
    const [members, setMembers] = useState<UserData[]>([]);

    // Fetch Member Data（サーバー API 経由。安全な項目のみ返る）
    useEffect(() => {
        const fetchMembers = async () => {
            if (!project.memberIds || project.memberIds.length === 0) {
                setMembers([]);
                return;
            }

            const buildFallback = (label: string): UserData[] =>
                project.memberIds.map((uid) => ({ uid, displayName: label, email: null, photoURL: null }));

            try {
                const currentUser = auth.currentUser;
                if (!currentUser) {
                    setMembers(buildFallback('Unknown User'));
                    return;
                }
                const token = await currentUser.getIdToken();
                const res = await fetch('/api/users/profile', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ uids: project.memberIds }),
                });
                if (!res.ok) throw new Error('Failed to fetch members');
                const data = await res.json();
                const byUid = new Map<string, UserData>(
                    (data.members as UserData[]).map((m) => [m.uid, m])
                );
                // API から返らなかった uid はフォールバック表示にする
                setMembers(
                    project.memberIds.map(
                        (uid) => byUid.get(uid) ?? { uid, displayName: 'Unknown User', email: null, photoURL: null }
                    )
                );
            } catch (e) {
                console.error('fetchMembers error:', e);
                setMembers(buildFallback('Error Loading'));
            }
        };
        fetchMembers();
    }, [project.memberIds]);

    const handleRemoveMember = async (uid: string) => {
        if (!confirm('Remove this member from the project?')) return;

        const newMemberIds = project.memberIds.filter(id => id !== uid);
        const newRoles = { ...project.roles };
        delete newRoles[uid];

        await updateProject(project.id, { memberIds: newMemberIds, roles: newRoles });
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
