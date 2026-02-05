import { useState } from 'react';
import { Users, Link as LinkIcon, Copy, Loader2, Trash2, Mail, Check, AlertTriangle, User, Send } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { HubRole } from '@/types';
import { collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface ProjectInviteModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectId: string;
    existingMemberIds: string[];
}

interface FoundUser {
    uid: string;
    email: string;
    displayName: string | null;
    photoURL: string | null;
}

export default function ProjectInviteModal({ isOpen, onClose, projectId, existingMemberIds }: ProjectInviteModalProps) {
    const { generateInviteLink, updateProject, projects, user } = useStore();

    // Determine current project to robustly handle updates if needed, though projectId is passed
    const project = projects.find(p => p.id === projectId);

    const [inviteRole, setInviteRole] = useState<HubRole>('member');
    const [inviteMode, setInviteMode] = useState<'link' | 'email'>('email');

    // Link State
    const [generatedLink, setGeneratedLink] = useState('');
    const [status, setStatus] = useState({ loading: false, message: '', type: 'info' as 'info' | 'error' | 'success' });

    // Email State
    const [email, setEmail] = useState('');
    const [foundUser, setFoundUser] = useState<FoundUser | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    if (!isOpen) return null;

    const resetState = () => {
        setGeneratedLink('');
        setStatus({ loading: false, message: '', type: 'info' });
        setEmail('');
        setFoundUser(null);
        setShowConfirm(false);
    };

    const handleClose = () => {
        resetState();
        onClose();
    };

    const handleGenerateLink = async () => {
        if (!confirm("Attention: Anyone with this link can join the project. Are you sure you want to generate a public link?")) return;

        setStatus({ loading: true, message: '', type: 'info' });
        const res = await generateInviteLink(projectId, undefined, inviteRole);
        setStatus({ loading: false, message: res.message, type: res.success ? 'success' : 'error' });
        if (res.success && res.joinLink) {
            setGeneratedLink(res.joinLink);
        }
    };

    const handleCheckEmail = async () => {
        if (!email.trim() || !project) return;
        setStatus({ loading: true, message: '', type: 'info' });
        setFoundUser(null);
        setShowConfirm(false);

        try {
            const q = query(collection(db, 'users'), where('email', '==', email.trim()));
            const snapshot = await getDocs(q);

            if (!snapshot.empty) {
                const userDoc = snapshot.docs[0];
                const userData = userDoc.data();

                if (existingMemberIds.includes(userDoc.id)) {
                    setStatus({ loading: false, message: 'User is already a member.', type: 'error' });
                    return;
                }

                setFoundUser({
                    uid: userDoc.id,
                    email: userData.email,
                    displayName: userData.displayName,
                    photoURL: userData.photoURL
                });
                setShowConfirm(true);
                setStatus({ loading: false, message: '', type: 'info' });
            } else {
                // User not found -> Propose to send Pending Invite
                setFoundUser(null);
                setShowConfirm(true); // Re-use confirm UI for "Send Invite"
                setStatus({ loading: false, message: '', type: 'info' });
            }
        } catch (e) {
            console.error(e);
            setStatus({ loading: false, message: 'Error checking user.', type: 'error' });
        }
    };

    const handleConfirmInvite = async () => {
        if (!project) return;
        setStatus({ loading: true, message: '', type: 'info' });

        try {
            if (foundUser) {
                // Direct Add
                const newMemberIds = [...project.memberIds, foundUser.uid];
                const newRoles = { ...project.roles, [foundUser.uid]: inviteRole };
                await updateProject(projectId, { memberIds: newMemberIds, roles: newRoles });
                setStatus({ loading: false, message: `Added ${foundUser.displayName || foundUser.email}!`, type: 'success' });
            } else {
                // Pending Invite
                try {
                    // Check if already invited
                    const qInvs = query(collection(db, 'invitations'), where('email', '==', email.trim()), where('projectId', '==', projectId));
                    const snapInvs = await getDocs(qInvs);

                    if (!snapInvs.empty) {
                        setStatus({ loading: false, message: 'An invite is already pending for this email.', type: 'error' });
                        return;
                    }

                    await addDoc(collection(db, 'invitations'), {
                        email: email.trim(),
                        projectId: projectId,
                        role: inviteRole,
                        invitedBy: user?.uid || 'unknown',
                        createdAt: Date.now()
                    });

                    // Send Email via API
                    try {
                        await fetch('/api/invite', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                email: email.trim(),
                                projectTitle: project?.title || 'Project',
                                inviterName: user?.displayName || 'A Team Member',
                                inviteLink: `${window.location.origin}/login`
                            })
                        });
                    } catch (emailErr) {
                        console.error("Failed to trigger email API", emailErr);
                    }

                    setStatus({ loading: false, message: `Invitation sent to ${email}`, type: 'success' });
                } catch (e) {
                    console.error("Error creating invite", e);
                    setStatus({ loading: false, message: 'Failed to create invitation.', type: 'error' });
                }
            }
            // Reset after delay
            setTimeout(() => {
                setEmail('');
                setFoundUser(null);
                setShowConfirm(false);
                setStatus({ loading: false, message: '', type: 'info' });
            }, 2000);
        } catch (e) {
            console.error(e);
            setStatus({ loading: false, message: 'Operation failed.', type: 'error' });
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        alert('Copied!');
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-95">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Users size={20} className="text-purple-600" />
                        Invite Team Member
                    </h2>
                    <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
                        <XIcon />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex bg-gray-100 p-1 rounded-lg mb-6">
                    <button
                        onClick={() => { setInviteMode('email'); resetState(); }}
                        className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-sm font-medium rounded-md transition-all ${inviteMode === 'email' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Mail size={16} /> Email
                    </button>
                    <button
                        onClick={() => { setInviteMode('link'); resetState(); }}
                        className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-sm font-medium rounded-md transition-all ${inviteMode === 'link' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <LinkIcon size={16} /> Link
                    </button>
                </div>

                {/* Role Selection (Common) */}
                <div className="mb-4">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Role</label>
                    <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as HubRole)}
                        className="w-full border border-gray-300 rounded-lg p-2 bg-white focus:ring-2 focus:ring-purple-500 outline-none text-sm"
                    >
                        <option value="member">Member (Can edit tasks)</option>
                        <option value="admin">Admin (Can manage project)</option>
                        <option value="viewer">Viewer (Read-only)</option>
                    </select>
                </div>

                {inviteMode === 'email' ? (
                    <div className="space-y-4">
                        {!showConfirm ? (
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">User Email</label>
                                <div className="flex gap-2">
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="colleague@example.com"
                                        className="flex-1 border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                        onKeyDown={(e) => e.key === 'Enter' && handleCheckEmail()}
                                    />
                                    <button
                                        onClick={handleCheckEmail}
                                        disabled={status.loading || !email}
                                        className="bg-purple-600 text-white px-3 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50"
                                    >
                                        {status.loading ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                                {foundUser ? (
                                    <div className="text-center mb-4">
                                        <div className="w-12 h-12 rounded-full bg-gray-200 mx-auto mb-2 overflow-hidden flex items-center justify-center">
                                            {foundUser.photoURL ? (
                                                <img src={foundUser.photoURL} className="w-full h-full object-cover" />
                                            ) : (
                                                <User className="text-gray-400" />
                                            )}
                                        </div>
                                        <p className="font-bold text-gray-900">{foundUser.displayName || 'Unnamed User'}</p>
                                        <p className="text-xs text-gray-500">{foundUser.email}</p>
                                        <div className="mt-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded inline-block">
                                            Registered User
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center mb-4">
                                        <div className="w-12 h-12 rounded-full bg-yellow-100 mx-auto mb-2 flex items-center justify-center">
                                            <Mail className="text-yellow-600" />
                                        </div>
                                        <p className="font-bold text-gray-900">{email}</p>
                                        <div className="mt-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded inline-block">
                                            Unregistered (Send Pending Invite)
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setShowConfirm(false)}
                                        className="flex-1 py-1.5 bg-white border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleConfirmInvite}
                                        disabled={status.loading}
                                        className="flex-1 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50"
                                    >
                                        {status.loading ? 'Adding...' : (foundUser ? 'Confirm Add' : 'Send Invite')}
                                    </button>
                                </div>
                            </div>
                        )}

                        {!showConfirm && (
                            <p className="text-xs text-gray-500">
                                Invites by email are secure. Unregistered users will join automatically upon signup.
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="bg-orange-50 border border-orange-100 rounded-lg p-3 flex gap-2">
                            <AlertTriangle size={32} className="text-orange-500 shrink-0" />
                            <p className="text-xs text-orange-800">
                                <strong>Warning:</strong> Anyone with this link can join this project. Use "Email Invite" for better security.
                            </p>
                        </div>

                        {!generatedLink ? (
                            <button
                                onClick={handleGenerateLink}
                                disabled={status.loading}
                                className="w-full py-2 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {status.loading ? <Loader2 size={18} className="animate-spin" /> : <LinkIcon size={18} />}
                                Generate Join Link
                            </button>
                        ) : (
                            <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg">
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
                        )}
                    </div>
                )}

                {/* Status Message */}
                {status.message && (
                    <div className={`mt-4 p-2 rounded text-xs ${status.type === 'error' ? 'bg-red-50 text-red-600' :
                        status.type === 'success' ? 'bg-green-50 text-green-600' : 'text-gray-500'
                        }`}>
                        {status.message}
                    </div>
                )}
            </div>
        </div>
    );
}

function XIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-x"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
    )
}
