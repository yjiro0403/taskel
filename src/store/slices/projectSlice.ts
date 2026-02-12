import { StateCreator } from 'zustand';
import { StoreState, ProjectSlice } from '../types';
import { HubRole } from '@/types';
import { collection, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeData } from '../helpers/sanitize';

// プロジェクトCRUD + 招待管理スライス
export const createProjectSlice: StateCreator<StoreState, [], [], ProjectSlice> = (set, get) => ({
    projects: [],

    addProject: async (project) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(collection(db, 'projects'), project.id || undefined);
                await setDoc(ref, sanitizeData({
                    ...project,
                    id: ref.id,
                    userId: user.uid,
                    ownerId: user.uid,
                    memberIds: [user.uid],
                    roles: { [user.uid]: 'owner' },
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                }));
            } catch (error) {
                console.error("Error adding project: ", error);
            }
        }
    },

    updateProject: async (projectId, updates) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(db, 'projects', projectId);
                await updateDoc(ref, sanitizeData({
                    ...updates,
                    updatedAt: Date.now()
                }));
            } catch (error) {
                console.error("Error updating project: ", error);
            }
        }
    },

    deleteProject: async (projectId) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(db, 'projects', projectId);
                await deleteDoc(ref);
            } catch (error) {
                console.error("Error deleting project: ", error);
            }
        }
    },

    inviteMember: async (projectId, email) => {
        const { user } = get();
        if (!user) return { success: false, message: 'Not authenticated' };

        try {
            const token = await user.getIdToken();
            const response = await fetch(`/api/projects/${projectId}/invite`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            if (!response.ok) {
                return { success: false, message: data.error || 'Failed to invite user' };
            }

            return { success: true, message: 'Invitation sent successfully' };
        } catch (error) {
            console.error("Error inviting member:", error);
            return { success: false, message: 'Network error or server unavailable' };
        }
    },

    generateInviteLink: async (projectId, email, role = 'member') => {
        const { user } = get();
        if (!user) return { success: false, message: 'Not authenticated' };
        try {
            const token = await user.getIdToken();
            const response = await fetch('/api/invitations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ projectId, email, role })
            });
            const data = await response.json();
            if (!response.ok) return { success: false, message: data.error || 'Failed to generate link' };
            return { success: true, joinLink: data.joinLink, message: 'Link generated' };
        } catch (error) {
            console.error("Error generating link:", error);
            return { success: false, message: 'Network error' };
        }
    },

    joinProjectWithToken: async (inviteToken) => {
        const { user } = get();
        if (!user) return { success: false, message: 'Not authenticated' };
        try {
            const token = await user.getIdToken();
            const response = await fetch('/api/invitations/join', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ inviteToken })
            });
            const data = await response.json();
            if (!response.ok) return { success: false, message: data.error || 'Failed to join' };
            return { success: true, projectId: data.projectId, message: data.message };
        } catch (error) {
            console.error("Error joining with token:", error);
            return { success: false, message: 'Network error' };
        }
    },
});
