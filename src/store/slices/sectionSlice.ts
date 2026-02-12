import { StateCreator } from 'zustand';
import { StoreState, SectionSlice } from '../types';
import { Section } from '@/types';
import {
    collection, doc, setDoc, updateDoc, deleteDoc,
    writeBatch, query, getDocs
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeData } from '../helpers/sanitize';

// セクションCRUD + rebuildSectionsスライス
export const createSectionSlice: StateCreator<StoreState, [], [], SectionSlice> = (set, get) => ({
    sections: [],

    addSection: async (section) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(collection(db, 'users', user.uid, 'sections'), section.id || undefined);
                await setDoc(ref, sanitizeData({ ...section, id: ref.id }));
            } catch (error) {
                console.error("Error adding section: ", error);
            }
        }
    },

    updateSection: async (sectionId, updates) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(db, 'users', user.uid, 'sections', sectionId);
                await updateDoc(ref, sanitizeData(updates));
            } catch (error) {
                console.error("Error updating section: ", error);
            }
        }
    },

    deleteSection: async (sectionId) => {
        const { user } = get();
        if (user) {
            try {
                const ref = doc(db, 'users', user.uid, 'sections', sectionId);
                await deleteDoc(ref);
            } catch (error) {
                console.error("Error deleting section: ", error);
            }
        }
    },

    rebuildSections: async () => {
        const { user } = get();
        if (!user) return;

        // 1. 標準セクションの定義
        const standards = [
            { name: 'Morning', startTime: '06:00', endTime: '09:00' },
            { name: 'Work', startTime: '09:00', endTime: '12:00' },
            { name: 'Afternoon', startTime: '13:00', endTime: '18:00' },
            { name: 'Night', startTime: '19:00', endTime: '22:00' }
        ];

        // 2. 時間変換ヘルパー
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

        for (const std of standards) {
            const startMins = convertToMinutes(std.startTime);
            const endMins = convertToMinutes(std.endTime);

            // ギャップの挿入
            if (currentMinutes < startMins) {
                const startStr = formatTime(currentMinutes);
                newSections.push({
                    id: `interval-${startStr}`,
                    userId: user.uid,
                    name: 'Interval',
                    startTime: startStr,
                    endTime: std.startTime,
                    order: newSections.length
                });
            }

            // 標準セクションの追加
            newSections.push({
                id: `section-${std.name.toLowerCase()}`,
                userId: user.uid,
                name: std.name,
                startTime: std.startTime,
                endTime: std.endTime,
                order: newSections.length
            });
            currentMinutes = endMins;
        }

        // 最後のギャップ
        if (currentMinutes < 24 * 60) {
            const startStr = formatTime(currentMinutes);
            newSections.push({
                id: `interval-${startStr}`,
                userId: user.uid,
                name: 'Interval',
                startTime: startStr,
                endTime: '24:00',
                order: newSections.length
            });
        }

        // 3. Firestoreにバッチ書き込み
        try {
            const batch = writeBatch(db);

            // 既存セクションの削除
            const q = query(collection(db, 'users', user.uid, 'sections'));
            const snapshot = await getDocs(q);
            snapshot.docs.forEach((docSnap) => {
                batch.delete(docSnap.ref);
            });

            // 新しいセクションの作成
            newSections.forEach(sec => {
                const ref = doc(collection(db, 'users', user.uid, 'sections'));
                batch.set(ref, sanitizeData({ ...sec, id: ref.id }));
            });

            await batch.commit();
        } catch (e) {
            console.error("Error rebuilding sections:", e);
        }
    },
});
