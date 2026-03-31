import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/types/supabase';
import { Section } from '@/types';
import { StoreState, SectionSlice } from '../types';

export const createSectionSlice: StateCreator<StoreState, [], [], SectionSlice> = (set, get) => ({
    sections: [],

    addSection: async (section) => {
        const { user } = get();
        if (!user) return;

        const payload: Database['public']['Tables']['sections']['Insert'] = {
            id: section.id,
            user_id: user.uid,
            name: section.name,
            start_time: section.startTime ?? null,
            end_time: section.endTime ?? null,
            order: section.order,
        };

        const { error } = await createClient().from('sections').insert(payload);
        if (error) {
            console.error('Error adding section:', error);
        }
    },

    updateSection: async (sectionId, updates) => {
        const payload: Database['public']['Tables']['sections']['Update'] = {
            name: updates.name,
            start_time: updates.startTime === undefined ? undefined : updates.startTime ?? null,
            end_time: updates.endTime === undefined ? undefined : updates.endTime ?? null,
            order: updates.order,
        };

        const { error } = await createClient().from('sections').update(payload).eq('id', sectionId);
        if (error) {
            console.error('Error updating section:', error);
        }
    },

    deleteSection: async (sectionId) => {
        const { error } = await createClient().from('sections').delete().eq('id', sectionId);
        if (error) {
            console.error('Error deleting section:', error);
        }
    },

    rebuildSections: async () => {
        const { user } = get();
        if (!user) return;

        const standards = [
            { name: 'Morning', startTime: '06:00', endTime: '09:00' },
            { name: 'Work', startTime: '09:00', endTime: '12:00' },
            { name: 'Afternoon', startTime: '13:00', endTime: '18:00' },
            { name: 'Night', startTime: '19:00', endTime: '22:00' },
        ];

        const convertToMinutes = (timeStr: string) => {
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
        };

        const formatTime = (totalMinutes: number) => {
            const h = Math.floor(totalMinutes / 60);
            const m = totalMinutes % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        const newSections: Section[] = [];
        let currentMinutes = 0;

        standards.sort((a, b) => convertToMinutes(a.startTime) - convertToMinutes(b.startTime));

        for (const standard of standards) {
            const startMins = convertToMinutes(standard.startTime);
            const endMins = convertToMinutes(standard.endTime);

            if (currentMinutes < startMins) {
                const startStr = formatTime(currentMinutes);
                newSections.push({
                    id: crypto.randomUUID(),
                    userId: user.uid,
                    name: 'Interval',
                    startTime: startStr,
                    endTime: standard.startTime,
                    order: newSections.length,
                });
            }

            newSections.push({
                id: crypto.randomUUID(),
                userId: user.uid,
                name: standard.name,
                startTime: standard.startTime,
                endTime: standard.endTime,
                order: newSections.length,
            });
            currentMinutes = endMins;
        }

        if (currentMinutes < 24 * 60) {
            const startStr = formatTime(currentMinutes);
            newSections.push({
                id: crypto.randomUUID(),
                userId: user.uid,
                name: 'Interval',
                startTime: startStr,
                endTime: '24:00',
                order: newSections.length,
            });
        }

        const client = createClient();
        const { error: deleteError } = await client.from('sections').delete().eq('user_id', user.uid);
        if (deleteError) {
            console.error('Error rebuilding sections:', deleteError);
            return;
        }

        const { error: insertError } = await client.from('sections').insert(
            newSections.map((section) => ({
                id: section.id,
                user_id: user.uid,
                name: section.name,
                start_time: section.startTime ?? null,
                end_time: section.endTime ?? null,
                order: section.order,
            }))
        );

        if (insertError) {
            console.error('Error rebuilding sections:', insertError);
        }
    },
});
