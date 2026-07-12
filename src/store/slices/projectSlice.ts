import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/types/supabase';
import { StoreState, ProjectSlice } from '../types';

export const createProjectSlice: StateCreator<StoreState, [], [], ProjectSlice> = (_set, get) => ({
    projects: [],

    addProject: async (project) => {
        const { user } = get();
        if (!user) return;

        const client = createClient();
        const projectPayload: Database['public']['Tables']['projects']['Insert'] = {
            id: project.id,
            owner_id: user.uid,
            title: project.title,
            description: project.description,
            status: project.status,
        };

        const { error: projectError } = await client.from('projects').insert(projectPayload);
        if (projectError) {
            console.error('Error adding project:', projectError);
            return;
        }

        const { error: memberError } = await client.from('project_members').insert({
            project_id: project.id,
            user_id: user.uid,
            role: 'owner',
        });

        if (memberError) {
            console.error('Error adding initial project member:', memberError);
        }
    },

    updateProject: async (projectId, updates) => {
        const payload: Database['public']['Tables']['projects']['Update'] = {
            title: updates.title,
            description: updates.description,
            status: updates.status,
        };

        const { error } = await createClient().from('projects').update(payload).eq('id', projectId);
        if (error) {
            console.error('Error updating project:', error);
        }
    },

    deleteProject: async (projectId) => {
        const { error } = await createClient().from('projects').delete().eq('id', projectId);
        if (error) {
            console.error('Error deleting project:', error);
        }
    },

    inviteMember: async (projectId, email, role = 'member') => {
        try {
            const response = await fetch(`/api/projects/${projectId}/invite`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, role }),
            });

            const data = await response.json();
            if (!response.ok) {
                return { success: false, message: data.error || 'Failed to invite user' };
            }

            return { success: true, message: 'Invitation sent successfully' };
        } catch (error) {
            console.error('Error inviting member:', error);
            return { success: false, message: 'Network error or server unavailable' };
        }
    },

    generateInviteLink: async (projectId, email, role = 'member') => {
        try {
            const response = await fetch('/api/invitations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ projectId, email, role }),
            });

            const data = await response.json();
            if (!response.ok) {
                return { success: false, message: data.error || 'Failed to generate link' };
            }

            return { success: true, joinLink: data.joinLink, message: 'Link generated' };
        } catch (error) {
            console.error('Error generating link:', error);
            return { success: false, message: 'Network error' };
        }
    },

    joinProjectWithToken: async (inviteToken) => {
        try {
            const response = await fetch('/api/invitations/join', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ inviteToken }),
            });

            const data = await response.json();
            if (!response.ok) {
                return { success: false, message: data.error || 'Failed to join' };
            }

            return { success: true, projectId: data.projectId, message: data.message };
        } catch (error) {
            console.error('Error joining with token:', error);
            return { success: false, message: 'Network error' };
        }
    },

    resetProjectSlice: () => _set({ projects: [] }),
});
