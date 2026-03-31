import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/types/supabase';
import { StoreState, TagSlice } from '../types';

export const createTagSlice: StateCreator<StoreState, [], [], TagSlice> = (set, get) => ({
    tags: [],

    addTag: async (tag) => {
        const { user } = get();
        if (!user) return '';

        const payload: Database['public']['Tables']['tags']['Insert'] = {
            id: tag.id,
            user_id: user.uid,
            name: tag.name,
            memo: tag.memo ?? null,
            color: tag.color ?? null,
        };

        const { data, error } = await createClient().from('tags').insert(payload).select('id').single();
        if (error) {
            console.error('Error adding tag:', error);
            return '';
        }

        return data.id;
    },

    updateTag: async (tagId, updates) => {
        const payload: Database['public']['Tables']['tags']['Update'] = {
            name: updates.name,
            memo: updates.memo === undefined ? undefined : updates.memo ?? null,
            color: updates.color === undefined ? undefined : updates.color ?? null,
        };

        const { error } = await createClient().from('tags').update(payload).eq('id', tagId);
        if (error) {
            console.error('Error updating tag:', error);
        }
    },

    deleteTag: async (tagId) => {
        const { error } = await createClient().from('tags').delete().eq('id', tagId);
        if (error) {
            console.error('Error deleting tag:', error);
        }
    },

    getUniqueTags: () => {
        const { tasks, tags } = get();
        const tagSet = new Set<string>();

        tags.forEach((tag) => tagSet.add(tag.name));
        tasks.forEach((task) => task.tags?.forEach((tag) => tagSet.add(tag)));

        return Array.from(tagSet).sort();
    },
});
