import { StateCreator } from 'zustand';
import { StoreState, TagSlice } from '../types';
import { collection, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeData } from '../helpers/sanitize';

// タグCRUD + getUniqueTagsスライス
export const createTagSlice: StateCreator<StoreState, [], [], TagSlice> = (set, get) => ({
    tags: [],

    addTag: async (tag) => {
        const { user } = get();
        if (user) {
            try {
                // グローバル 'tags' コレクション
                const ref = doc(collection(db, 'tags'), tag.id || undefined);
                await setDoc(ref, sanitizeData({
                    ...tag,
                    id: ref.id,
                    userId: user.uid
                }));
                return ref.id;
            } catch (error) {
                console.error("Error adding tag: ", error);
                return '';
            }
        }
        return '';
    },

    updateTag: async (tagId, updates) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(db, 'tags', tagId);
                await updateDoc(ref, sanitizeData(updates));
            } catch (error) {
                console.error("Error updating tag: ", error);
            }
        }
    },

    deleteTag: async (tagId) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(db, 'tags', tagId);
                await deleteDoc(ref);
            } catch (error) {
                console.error("Error deleting tag: ", error);
            }
        }
    },

    getUniqueTags: () => {
        const { tasks, tags } = get();
        const tagSet = new Set<string>();

        // グローバルタグ
        tags.forEach(t => tagSet.add(t.name));

        // レガシータスクタグ（下位互換）
        tasks.forEach(task => {
            if (task.tags) {
                task.tags.forEach(tag => tagSet.add(tag));
            }
        });
        return Array.from(tagSet).sort();
    },
});
