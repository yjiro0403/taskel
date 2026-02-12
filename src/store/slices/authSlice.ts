import { StateCreator } from 'zustand';
import { StoreState, AuthSlice } from '../types';
import { Task, Section, Routine, Tag, DailyNote, WeeklyNote, MonthlyNote, Project } from '@/types';
import {
    collection, query, onSnapshot, where
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Unsubscribe } from 'firebase/auth';
import { handleFirestoreError } from '../helpers/firestoreError';

// 認証 + Firestoreリスナー管理スライス
export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => ({
    user: null,
    unsubscribe: null,

    setUser: (user) => {
        // 前回のサブスクリプションをクリーンアップ
        const { unsubscribe } = get();
        if (unsubscribe) {
            unsubscribe();
        }

        set({ user, unsubscribe: null });

        if (user) {
            // サブサブスクリプションのトラッキング
            let unsubShared: (() => void) | null = null;
            let unsubProjects: (() => void) | null = null;

            // タスクのサブスクリプション（グローバルコレクション）
            const qTasks = query(collection(db, 'tasks'), where('userId', '==', user.uid));
            const unsubTasks = onSnapshot(qTasks, (snapshot) => {
                const tasks = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Task));
                set(state => {
                    const currentShared = state.tasks.filter(t => t.projectId);
                    const combined = [...tasks, ...currentShared];
                    const unique = Array.from(new Map(combined.map(t => [t.id, t])).values());
                    return { tasks: unique };
                });
            }, (error) => handleFirestoreError(error, 'tasks'));

            // ルーティンのサブスクリプション
            const qRoutines = query(collection(db, 'users', user.uid, 'routines'));
            const unsubRoutines = onSnapshot(qRoutines, (snapshot) => {
                const routines = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Routine));
                set({ routines });
            }, (error) => handleFirestoreError(error, 'routines'));

            // タグのサブスクリプション（グローバルコレクション）
            const qTags = query(collection(db, 'tags'), where('userId', '==', user.uid));
            const unsubTags = onSnapshot(qTags, (snapshot) => {
                const tags = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Tag));
                set({ tags });
            }, (error) => handleFirestoreError(error, 'tags'));

            // プロジェクトのサブスクリプション（メンバーシップベース）
            const qProjects = query(
                collection(db, 'projects'),
                where('memberIds', 'array-contains', user.uid)
            );

            unsubProjects = onSnapshot(qProjects, (snapshot) => {
                const projects = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Project));
                set({ projects });

                // プロジェクト変更時に共有タスクを再購読
                const projectIds = projects.map(p => p.id);

                // 前回の共有タスクサブスクリプションをクリーンアップ
                if (unsubShared) {
                    unsubShared();
                    unsubShared = null;
                }

                if (projectIds.length > 0) {
                    const projectTasksCache: Record<string, Task[]> = {};
                    const unsubs: Unsubscribe[] = [];

                    const updateSharedTasksState = () => {
                        const allSharedTasks = Object.values(projectTasksCache).flat();
                        set(state => {
                            const personalTasks = state.tasks.filter(t => !t.projectId);
                            const combined = [...personalTasks, ...allSharedTasks];
                            const unique = Array.from(new Map(combined.map(t => [t.id, t])).values());
                            return { tasks: unique };
                        });
                    };

                    projectIds.forEach(projectId => {
                        const qProjectTasks = query(
                            collection(db, 'tasks'),
                            where('projectId', '==', projectId)
                        );

                        const unsub = onSnapshot(qProjectTasks, (snapshot) => {
                            const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
                            projectTasksCache[projectId] = tasks;
                            updateSharedTasksState();
                        }, (error) => handleFirestoreError(error, `project tasks ${projectId}`));
                        unsubs.push(unsub);
                    });

                    // 複合アンサブスクライブ関数の作成
                    unsubShared = () => {
                        unsubs.forEach(u => u());
                    };
                } else {
                    // プロジェクトがない場合、共有タスクをクリア
                    set(state => {
                        const personalTasks = state.tasks.filter(t => !t.projectId);
                        return { tasks: personalTasks };
                    });
                }
            }, (error) => handleFirestoreError(error, 'projects'));

            // デイリーノートのサブスクリプション
            const qNotes = query(collection(db, 'users', user.uid, 'dailyNotes'));
            const unsubNotes = onSnapshot(qNotes, (snapshot) => {
                const dailyNotes = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as DailyNote));
                set({ dailyNotes });
            }, (error) => handleFirestoreError(error, 'dailyNotes'));

            // ウィークリーノートのサブスクリプション
            const qWeeklyNotes = query(collection(db, 'users', user.uid, 'weeklyNotes'));
            const unsubWeeklyNotes = onSnapshot(qWeeklyNotes, (snapshot) => {
                const weeklyNotes = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as WeeklyNote));
                set({ weeklyNotes });
            }, (error) => handleFirestoreError(error, 'weeklyNotes'));

            // マンスリーノートのサブスクリプション
            const qMonthlyNotes = query(collection(db, 'users', user.uid, 'monthlyNotes'));
            const unsubMonthlyNotes = onSnapshot(qMonthlyNotes, (snapshot) => {
                const monthlyNotes = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as MonthlyNote));
                set({ monthlyNotes });
            }, (error) => handleFirestoreError(error, 'monthlyNotes'));

            // セクションのサブスクリプション
            const qSections = query(collection(db, 'users', user.uid, 'sections'));
            const unsubSections = onSnapshot(qSections, async (snapshot) => {
                if (snapshot.empty) {
                    // localStorageでオンボーディング重複を防止（広告ブロッカー対策）
                    const hasSeenOnboarding = localStorage.getItem('has_seen_onboarding');
                    if (hasSeenOnboarding) {
                        set({ sections: [] });
                        return;
                    }

                    localStorage.setItem('has_seen_onboarding', 'true');

                    // サーバーサイドオンボーディングAPI（BFFパターン）
                    try {
                        await fetch('/api/onboarding', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: user.uid })
                        });
                    } catch (error) {
                        console.error("Onboarding API failed:", error);
                    }
                    return;
                }
                const sections = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Section));
                sections.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.order - b.order);
                set({ sections });
            }, (error) => handleFirestoreError(error, 'sections'));

            // 全アンサブスクリプションの登録
            set({
                unsubscribe: () => {
                    unsubTasks();
                    unsubRoutines();
                    unsubTags();
                    unsubNotes();
                    if (unsubWeeklyNotes) unsubWeeklyNotes();
                    unsubSections();
                    if (unsubProjects) unsubProjects();
                    if (unsubShared) unsubShared();
                }
            });
        } else {
            // ログアウト時にモックデータまたは空配列にリセット
            set({ tasks: [], routines: [], tags: [], sections: [] });
        }
    },
});
