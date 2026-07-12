import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import {
    fetchGoals,
    fetchNotes,
    fetchProjectById,
    fetchProjects,
    fetchRoutines,
    fetchSections,
    fetchTags,
    fetchTaskById,
    fetchTasks,
    subscribeTable,
    unsubscribeChannels,
} from '@/lib/supabase/data';
import { mapGoal, mapRoutine, mapSection, mapTag } from '@/lib/supabase/mappers';
import type { DailyNote, Goal, MonthlyNote, Routine, Section, Tag, WeeklyNote, YearlyNote } from '@/types';
import type { Database } from '@/types/supabase';
import { StoreState, AuthSlice } from '../types';
import { isPendingTask } from '../helpers/pendingTasks';

type Tables = Database['public']['Tables'];
type RealtimePayload<Row extends Record<string, unknown> = Record<string, unknown>> = {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    new: Row;
    old: Row;
};

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
    const nextItems = items.filter((item) => item.id !== nextItem.id);
    nextItems.push(nextItem);
    return nextItems;
}

function sortSections(sections: Section[]) {
    return [...sections].sort(
        (a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.order - b.order
    );
}

function upsertNote<T extends { id: string }>(items: T[], nextItem: T) {
    return upsertById(items, nextItem);
}

function buildInFilter(column: string, ids: string[]) {
    if (ids.length === 0) {
        return null;
    }

    return `${column}=in.(${ids.join(',')})`;
}

// Realtime チャンネルのトピック名は必ず一意にする必要がある。
// @supabase/realtime-js の `client.channel(topic)` は「同一トピック名の既存チャンネルが
// あればそれを返す（新規作成しない）」ため、rebuild で同名トピックを再利用すると
//   1. open 済みチャンネルへの subscribe() が no-op になりフィルタ変更がサーバへ反映されない
//   2. 直後の旧チャンネル破棄で「継続すべき現行チャンネル」を巻き添えに teardown してしまう
// という破綻を招く（初期ロード後に realtime 反映が止まる）。
// そこでチャンネル生成のたびに単調増加するグローバル世代番号をトピックへ付与し、
// 常に新規チャンネルオブジェクトが生成されることを保証する。
// モジュールスコープにするのは、ユーザー切替でクロージャが作り直されても、
// 前クロージャの teardown 待ちチャンネルとトピックが衝突しないようにするため。
let channelTopicGeneration = 0;

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => ({
    user: null,
    unsubscribe: null,

    resetStore: () => {
        get().resetTaskSlice();
        get().resetSectionSlice();
        get().resetProjectSlice();
        get().resetRoutineSlice();
        get().resetTagSlice();
        get().resetNoteSlice();
        get().resetGoalSlice();
        get().resetAISlice();
        get().resetBillingSlice();
        get().resetWorkspaceSlice();
        get().resetUISlice();
    },

    signOut: async () => {
        const existingUnsubscribe = get().unsubscribe;
        if (existingUnsubscribe) {
            existingUnsubscribe();
        }

        await createClient().auth.signOut();
        set({ user: null, unsubscribe: null });
        get().resetStore();
    },

    setUser: (user) => {
        const currentUser = get().user;
        const existingUnsubscribe = get().unsubscribe;

        // 同一ユーザーで既に購読済みなら、購読を張り直さず user 情報のみ更新して return する。
        // AuthProvider の useEffect は pathname を依存に持つため画面遷移のたびに
        // syncAuthState → setUser が再実行され、onAuthStateChange（TOKEN_REFRESHED 等）でも
        // 再実行される。毎回全チャンネルを破棄→再構築するとその隙間で realtime イベントを
        // 取りこぼす。購読フィルタは全て user.uid 基準なので、uid が同じなら購読内容は不変。
        // （displayName/photoURL のみ変更する setUser も、購読を保ったまま user 情報を反映できる）
        if (user && currentUser && existingUnsubscribe && currentUser.uid === user.uid) {
            set({ user });
            return;
        }

        if (existingUnsubscribe) {
            existingUnsubscribe();
        }

        set({ user, unsubscribe: null });

        if (!user) {
            get().resetStore();
            return;
        }

        const supabase = createClient();
        let disposed = false;
        // 論理キー（例: `tags:${uid}`）→ { channel, filter } のマップ。
        // 差分方式で「フィルタが変わったチャンネルだけ」差し替えるため、生成時の
        // トピック名（世代付き・毎回変わる）ではなくフィルタ非依存の論理キーで引けるようにする。
        type DataChannel = { channel: ReturnType<typeof subscribeTable>; filter: string | undefined };
        let dataChannels = new Map<string, DataChannel>();
        // 直近の購読対象IDシグネチャ。集合が同一なら rebuild を丸ごとスキップする（チャーン抑制）。
        let lastSubscriptionSignature: string | null = null;
        let membershipChannel: ReturnType<typeof subscribeTable> | null = null;

        const refreshInitialState = async () => {
            try {
                const tags = await fetchTags(supabase);
                const [tasks, routines, sections, projects, goals, notes] = await Promise.all([
                    fetchTasks(supabase, tags),
                    fetchRoutines(supabase),
                    fetchSections(supabase),
                    fetchProjects(supabase),
                    fetchGoals(supabase),
                    fetchNotes(supabase),
                ]);

                if (disposed) {
                    return;
                }

                rebuildDataSubscriptions(
                    projects.map((project) => project.id),
                    tasks.map((task) => task.id)
                );

                set((state) => {
                    const localPendingTasks = state.tasks.filter((task) => isPendingTask(task.id));
                    const taskMap = new Map(tasks.map((task) => [task.id, task]));
                    localPendingTasks.forEach((task) => taskMap.set(task.id, task));

                    return {
                        tasks: Array.from(taskMap.values()),
                        tags,
                        routines,
                        sections: sortSections(sections),
                        projects,
                        goals,
                        dailyNotes: notes.dailyNotes,
                        weeklyNotes: notes.weeklyNotes,
                        monthlyNotes: notes.monthlyNotes,
                        yearlyNotes: notes.yearlyNotes,
                    };
                });

                if (sections.length === 0) {
                    const hasSeenOnboarding = localStorage.getItem('has_seen_onboarding');
                    if (!hasSeenOnboarding) {
                        localStorage.setItem('has_seen_onboarding', 'true');
                        await fetch('/api/onboarding', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({}),
                        });
                        await refreshInitialState();
                    }
                }
            } catch (error) {
                console.error('Failed to refresh Supabase state:', error);
            }
        };

        const syncTask = async (taskId: string, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => {
            if (disposed) {
                return;
            }

            if (eventType === 'DELETE') {
                set((state) => ({
                    tasks: state.tasks.filter((task) => task.id !== taskId),
                }));
                rebuildDataSubscriptions(
                    get().projects.map((project) => project.id),
                    get().tasks.filter((task) => task.id !== taskId).map((task) => task.id)
                );
                return;
            }

            try {
                const task = await fetchTaskById(supabase, taskId);
                if (!task || disposed) {
                    return;
                }

                set((state) => ({
                    // pending中（書き込み飛行中）のタスクはローカルの楽観的状態を優先し、
                    // realtime版で上書きしない。他の pending タスクも配列から除去せず保持する
                    // （従来は filter で無関係な pending タスクごと消し、ドラッグ/編集中の
                    // タスクが realtime イベント到来時に一瞬消える不具合があった）。
                    tasks: isPendingTask(task.id) ? state.tasks : upsertById(state.tasks, task),
                }));
                rebuildDataSubscriptions(
                    get().projects.map((project) => project.id),
                    get().tasks.map((entry) => entry.id)
                );
            } catch (error) {
                console.error('Failed to sync task:', error);
            }
        };

        const syncProject = async (projectId: string, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => {
            if (disposed) {
                return;
            }

            if (eventType === 'DELETE') {
                set((state) => ({
                    projects: state.projects.filter((project) => project.id !== projectId),
                }));
                return;
            }

            try {
                const project = await fetchProjectById(supabase, projectId);
                if (!project || disposed) {
                    return;
                }

                set((state) => ({
                    projects: upsertById(state.projects, project),
                }));
            } catch (error) {
                console.error('Failed to sync project:', error);
            }
        };

        const syncCollectionItem = <T extends { id: string }>(
            key: 'tags' | 'sections' | 'routines' | 'goals',
            mapper: (row: never) => T,
            payload: RealtimePayload
        ) => {
            const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
            if (!row?.id) {
                return;
            }

            if (key === 'tags') {
                const mapped = mapper(row as never) as unknown as Tag;
                set((state) => ({
                    tags:
                        payload.eventType === 'DELETE'
                            ? state.tags.filter((tag) => tag.id !== row.id)
                            : upsertById(state.tags, mapped),
                }));
                return;
            }

            if (key === 'sections') {
                const mapped = mapper(row as never) as unknown as Section;
                set((state) => ({
                    sections:
                        payload.eventType === 'DELETE'
                            ? state.sections.filter((section) => section.id !== row.id)
                            : sortSections(upsertById(state.sections, mapped)),
                }));
                return;
            }

            if (key === 'routines') {
                const mapped = mapper(row as never) as unknown as Routine;
                set((state) => ({
                    routines:
                        payload.eventType === 'DELETE'
                            ? state.routines.filter((routine) => routine.id !== row.id)
                            : upsertById(state.routines, mapped),
                }));
                return;
            }

            const mapped = mapper(row as never) as unknown as Goal;
            set((state) => ({
                goals:
                    payload.eventType === 'DELETE'
                        ? state.goals.filter((goal) => goal.id !== row.id)
                        : upsertById(state.goals, mapped),
            }));
        };

        const syncNote = (payload: RealtimePayload<Tables['notes']['Row']>) => {
            const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
            if (!row?.period_key) {
                return;
            }

            const mapped = {
                id: row.period_key,
                userId: row.user_id,
                content: row.content,
                updatedAt: new Date(row.updated_at).getTime(),
            };

            set((state) => {
                if (row.type === 'daily') {
                    return {
                        dailyNotes:
                            payload.eventType === 'DELETE'
                                ? state.dailyNotes.filter((note) => note.id !== mapped.id)
                                : upsertNote<DailyNote>(state.dailyNotes, mapped),
                    };
                }
                if (row.type === 'weekly') {
                    return {
                        weeklyNotes:
                            payload.eventType === 'DELETE'
                                ? state.weeklyNotes.filter((note) => note.id !== mapped.id)
                                : upsertNote<WeeklyNote>(state.weeklyNotes, mapped),
                    };
                }
                if (row.type === 'monthly') {
                    return {
                        monthlyNotes:
                            payload.eventType === 'DELETE'
                                ? state.monthlyNotes.filter((note) => note.id !== mapped.id)
                                : upsertNote<MonthlyNote>(state.monthlyNotes, mapped),
                    };
                }

                return {
                    yearlyNotes:
                        payload.eventType === 'DELETE'
                            ? state.yearlyNotes.filter((note) => note.id !== mapped.id)
                            : upsertNote<YearlyNote>(state.yearlyNotes, mapped),
                };
            });
        };

        const rebuildDataSubscriptions = (projectIds: string[], taskIds: string[]) => {
            if (disposed) {
                return;
            }

            // IDの集合を正規化（重複排除＋ソート）し、フィルタ文字列を安定化させる。
            // 並び順の違いだけで無駄な差し替えが起きないようにするため。
            const sortedProjectIds = Array.from(new Set(projectIds)).sort();
            const sortedTaskIds = Array.from(new Set(taskIds)).sort();

            // 購読対象IDの集合が前回と同一なら、全フィルタが不変なので張り直し不要。
            // syncTask が INSERT/UPDATE/DELETE のたびに rebuild を呼んでも、
            // 実際にIDの集合が変化した時だけ以降の差分処理が走る（チャーン抑制）。
            const subscriptionSignature = `${sortedProjectIds.join(',')}|${sortedTaskIds.join(',')}`;
            if (subscriptionSignature === lastSubscriptionSignature && dataChannels.size > 0) {
                return;
            }
            lastSubscriptionSignature = subscriptionSignature;

            const projectFilter = buildInFilter('id', sortedProjectIds);
            const projectScopedFilter = buildInFilter('project_id', sortedProjectIds);
            const taskTagFilter = buildInFilter('task_id', sortedTaskIds);

            const previousChannels = dataChannels;
            const nextChannels = new Map<string, DataChannel>();
            const staleChannels: ReturnType<typeof subscribeTable>[] = [];

            // 論理キー単位の差分適用。フィルタが不変なら既存チャンネルをそのまま次世代へ移し
            // （破棄も再作成もしない＝no-op subscribe も誤破棄も構造的に起こらない）、
            // フィルタが変わった／新規のキーだけ一意トピックで新規生成し、旧チャンネルを stale に回す。
            const ensureChannel = (
                key: string,
                table: keyof Tables,
                onChange: Parameters<typeof subscribeTable>[3],
                filter: string | undefined
            ) => {
                const existing = previousChannels.get(key);
                if (existing && existing.filter === filter) {
                    nextChannels.set(key, existing);
                    return;
                }
                if (existing) {
                    staleChannels.push(existing.channel);
                }
                channelTopicGeneration += 1;
                const channel = subscribeTable(
                    supabase,
                    `${key}:g${channelTopicGeneration}`,
                    table,
                    onChange,
                    filter
                );
                nextChannels.set(key, { channel, filter });
            };

            ensureChannel(
                `tags:${user.uid}`,
                'tags',
                (payload) => syncCollectionItem('tags', mapTag, payload),
                `user_id=eq.${user.uid}`
            );
            ensureChannel(
                `tasks:personal:${user.uid}`,
                'tasks',
                (payload) => void syncTask((payload.new?.id ?? payload.old?.id) as string, payload.eventType),
                `user_id=eq.${user.uid}`
            );
            if (projectScopedFilter) {
                ensureChannel(
                    `tasks:projects:${user.uid}`,
                    'tasks',
                    (payload) => void syncTask((payload.new?.id ?? payload.old?.id) as string, payload.eventType),
                    projectScopedFilter
                );
            }
            if (projectFilter) {
                ensureChannel(
                    `projects:${user.uid}`,
                    'projects',
                    (payload) => void syncProject((payload.new?.id ?? payload.old?.id) as string, payload.eventType),
                    projectFilter
                );
            }
            ensureChannel(
                `routines:personal:${user.uid}`,
                'routines',
                (payload) => syncCollectionItem('routines', mapRoutine, payload),
                `user_id=eq.${user.uid}`
            );
            if (projectScopedFilter) {
                ensureChannel(
                    `routines:projects:${user.uid}`,
                    'routines',
                    (payload) => syncCollectionItem('routines', mapRoutine, payload),
                    projectScopedFilter
                );
            }
            ensureChannel(
                `sections:${user.uid}`,
                'sections',
                (payload) => syncCollectionItem('sections', mapSection, payload),
                `user_id=eq.${user.uid}`
            );
            ensureChannel(
                `goals:personal:${user.uid}`,
                'goals',
                (payload) => syncCollectionItem('goals', mapGoal, payload),
                `user_id=eq.${user.uid}`
            );
            if (projectScopedFilter) {
                ensureChannel(
                    `goals:projects:${user.uid}`,
                    'goals',
                    (payload) => syncCollectionItem('goals', mapGoal, payload),
                    projectScopedFilter
                );
            }
            ensureChannel(
                `notes:${user.uid}`,
                'notes',
                (payload) => syncNote(payload as RealtimePayload<Tables['notes']['Row']>),
                `user_id=eq.${user.uid}`
            );
            ensureChannel(
                `task-tags:${user.uid}`,
                'task_tags',
                (payload) => {
                    const taskId = (payload.new?.task_id ?? payload.old?.task_id) as string | undefined;
                    if (!taskId) {
                        return;
                    }
                    void syncTask(taskId, payload.eventType === 'DELETE' ? 'UPDATE' : payload.eventType);
                },
                taskTagFilter ?? undefined
            );

            // 今回の購読対象から外れた論理キー（例: 全プロジェクト離脱で projectScoped 系が消えた）を破棄する。
            for (const [key, entry] of previousChannels) {
                if (!nextChannels.has(key)) {
                    staleChannels.push(entry.channel);
                }
            }

            dataChannels = nextChannels;

            // staleChannels には nextChannels に残るチャンネルは構造的に含まれない：
            //   - フィルタ不変のキーは existing を next へ移すだけで stale には積まない
            //   - フィルタ変更／新規のキーは別オブジェクトを新規生成する
            //   - 1論理キー = 高々1チャンネルでオブジェクト共有は無い
            // よって「継続すべき現行チャンネル」を巻き添えに破棄することはない。
            if (staleChannels.length > 0) {
                void unsubscribeChannels(supabase, staleChannels);
            }
        };

        void refreshInitialState();
        void get().fetchBillingInfo();
        rebuildDataSubscriptions(
            get().projects.map((project) => project.id),
            get().tasks.map((task) => task.id)
        );

        channelTopicGeneration += 1;
        membershipChannel = subscribeTable(
            supabase,
            // データチャンネルと同様、世代番号でトピックを一意化する。
            // サインアウト→同一ユーザーで再サインイン時に、前回チャンネルの teardown 待ちと
            // 同名トピックが衝突して subscribe() が no-op になるのを防ぐ。
            `project-members:${user.uid}:g${channelTopicGeneration}`,
            'project_members',
            async (payload) => {
                const projectId = (payload.new?.project_id ?? payload.old?.project_id) as string | undefined;
                if (!projectId) {
                    return;
                }

                if (payload.eventType === 'DELETE') {
                    set((state) => ({
                        projects: state.projects.filter((project) => project.id !== projectId),
                        tasks: state.tasks.filter((task) => task.projectId !== projectId),
                        routines: state.routines.filter((routine) => routine.projectId !== projectId),
                        goals: state.goals.filter((goal) => goal.projectId !== projectId),
                    }));
                } else {
                    await syncProject(projectId, 'UPDATE');
                }

                rebuildDataSubscriptions(
                    get().projects.map((project) => project.id),
                    get().tasks.map((task) => task.id)
                );
            },
            `user_id=eq.${user.uid}`
        );

        set({
            unsubscribe: () => {
                disposed = true;
                // サインアウト／ユーザー切替時は全チャンネル（データ＋メンバーシップ）を確実に破棄する。
                // 参照を先に切り離してから破棄することで、破棄途中に再度 rebuild が走っても
                // 既に手放したチャンネルへ触れないようにする（購読解除漏れ＝リーク防止）。
                const channelsToRemove = Array.from(dataChannels.values()).map((entry) => entry.channel);
                if (membershipChannel) {
                    channelsToRemove.push(membershipChannel);
                }
                dataChannels = new Map();
                lastSubscriptionSignature = null;
                membershipChannel = null;
                if (channelsToRemove.length > 0) {
                    void unsubscribeChannels(supabase, channelsToRemove);
                }
            },
        });
    },
});
