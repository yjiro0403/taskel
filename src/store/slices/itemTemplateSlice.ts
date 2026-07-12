import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import type { Database, Json } from '@/types/supabase';
import { StoreState, ItemTemplateSlice } from '../types';

// 持ち物テンプレートのスライス。
// ローカルへ楽観的に反映してから DB へ書き、失敗時は操作前の配列へ巻き戻す。
// 他デバイスの変更は authSlice の realtime 購読（item_templates チャンネル）で upsert される。
export const createItemTemplateSlice: StateCreator<StoreState, [], [], ItemTemplateSlice> = (set, get) => ({
    itemTemplates: [],

    addItemTemplate: async (template) => {
        const { user } = get();
        if (!user) return false;

        const previous = get().itemTemplates;
        set({ itemTemplates: [...previous, template] });

        const payload: Database['public']['Tables']['item_templates']['Insert'] = {
            id: template.id,
            user_id: user.uid,
            name: template.name,
            items: template.items as Json,
        };

        const { error } = await createClient().from('item_templates').insert(payload);
        if (error) {
            console.error('Error adding item template:', error);
            set({ itemTemplates: previous });
            return false;
        }

        return true;
    },

    updateItemTemplate: async (templateId, updates) => {
        const previous = get().itemTemplates;
        set({
            itemTemplates: previous.map((template) =>
                template.id === templateId ? { ...template, ...updates } : template
            ),
        });

        const payload: Database['public']['Tables']['item_templates']['Update'] = {
            name: updates.name,
            items: updates.items === undefined ? undefined : (updates.items as Json),
        };

        const { error } = await createClient().from('item_templates').update(payload).eq('id', templateId);
        if (error) {
            console.error('Error updating item template:', error);
            set({ itemTemplates: previous });
            return false;
        }

        return true;
    },

    deleteItemTemplate: async (templateId) => {
        const previous = get().itemTemplates;
        set({ itemTemplates: previous.filter((template) => template.id !== templateId) });

        const { error } = await createClient().from('item_templates').delete().eq('id', templateId);
        if (error) {
            console.error('Error deleting item template:', error);
            set({ itemTemplates: previous });
            return false;
        }

        return true;
    },

    resetItemTemplateSlice: () => set({ itemTemplates: [] }),
});
