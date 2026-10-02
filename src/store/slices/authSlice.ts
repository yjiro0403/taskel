import { StateCreator } from 'zustand';

import { formatLocalDate } from '@/lib/calendarService';
import { createClient } from '@/lib/supabase/client';
import {
    fetchGoals,
    fetchItemTemplates,
    fetchNotes,
    fetchProjectById,
    fetchProjects,
    fetchRoutines,
    fetchSections,
    fetchTags,
    fetchTaskById,
    fetchTaskIdsBetween,
    fetchTasks,
    fetchTasksUpdatedSince,
    subscribeTable,
    unsubscribeChannels,
    type SubscribeStatus,
} from '@/lib/supabase/data';
import { mapGoal, mapItemTemplate, mapRoutine, mapSection, mapTag } from '@/lib/supabase/mappers';
import {
    createRealtimeHealth,
    mergeResyncedTasks,
    reconcileMissingTasks,
    replaceWithFullTaskList,
    resyncDateWindow,
    shouldResyncOnVisible,
    taskWatermarkFrom,
    watchForegroundReturns,
    watermarkQueryBound,
    type ResyncReason,
} from '@/lib/sync/resync';
import type { DailyNote, Goal, ItemTemplate, MonthlyNote, Routine, Section, Tag, WeeklyNote, YearlyNote } from '@/types';
import type { Database } from '@/types/supabase';
import { StoreState, AuthSlice } from '../types';
import { isPendingTask } from '../helpers/pendingTasks';
import { shouldReloadUserData } from '../helpers/shouldReloadUserData';

type Tables = Database['public']['Tables'];
// re-export status type consumers may need
export type { InitialDataStatus } from '../helpers/shouldReloadUserData';
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

// 現在ログイン中ユーザーの追いつき同期（resync）関数。setUser のクロージャが所有する
// ウォーターマーク・購読状態に依存するため、スライスの公開メソッドからはここ経由で呼ぶ。
let activeResync: ((reason: ResyncReason) => Promise<void>) | null = null;

// 複数チャンネルがほぼ同時に再購読したときに差分取得を 1 回にまとめる待ち時間。
const RESYNC_DEBOUNCE_MS = 750;
// 1 回の保存で tasks の UPDATE と task_tags の DELETE/INSERT（タグ数×2 件）が連続して届く。
// 同一 ID のイベントを短くまとめ、fetchTaskById を 1 回にする。
const TASK_SYNC_COALESCE_MS = 150;
// サーバー側で閉じられた（CLOSED）チャンネルを張り直すまでの待ち時間（試行回数ごと）。
const CHANNEL_RECREATE_DELAYS_MS = [1_000, 2_000, 5_000, 10_000];

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => ({
    user: null,
    unsubscribe: null,
    initialDataStatus: 'idle',
    lastResyncAt: null,

    resyncFromServer: (reason) => (activeResync ? activeResync(reason) : Promise.resolve()),

    resetStore: () => {
        get().resetTaskSlice();
        get().resetSectionSlice();
        get().resetProjectSlice();
        get().resetRoutineSlice();
        get().resetTagSlice();
        get().resetItemTemplateSlice();
        get().resetNoteSlice();
        get().resetGoalSlice();
        get().resetAISlice();
        get().resetBillingSlice();
        get().resetWorkspaceSlice();
        get().resetAlarmSlice();
        get().resetFinanceSlice();
        get().resetUIPreferenceSlice();
        get().resetAnalyticsSlice();
        get().resetUISlice();
    },

    signOut: async () => {
        const existingUnsubscribe = get().unsubscribe;
        if (existingUnsubscribe) {
            existingUnsubscribe();
        }

        await createClient().auth.signOut();
        set({ user: null, unsubscribe: null, initialDataStatus: 'idle', lastResyncAt: null });
        get().resetStore();
    },

    setUser: (user) => {
        const existingUser = get().user;
        const initialDataStatus = get().initialDataStatus;
        const existingUnsubscribe = get().unsubscribe;

        // Same uid + ready/loading: profile edits / token refresh / duplicate AuthProvider
        // events update user fields only — do not tear down realtime channels.
        // Same uid + error|idle: fall through and retry bootstrap (failed fetch retry).
        // AuthProvider pathname re-entry and TOKEN_REFRESHED would otherwise churn subscriptions.
        if (user && !shouldReloadUserData(existingUser?.uid, user.uid, initialDataStatus)) {
            set({ user });
            return;
        }

        if (existingUnsubscribe) {
            existingUnsubscribe();
        }

        if (!user) {
            set({ user: null, unsubscribe: null, initialDataStatus: 'idle', lastResyncAt: null });
            get().resetStore();
            return;
        }

        if (existingUser?.uid && existingUser.uid !== user.uid) {
            get().resetFinanceSlice();
        }

        // Mark loading before any await so a concurrent same-uid setUser will not race a second fetch.
        set({ user, unsubscribe: null, initialDataStatus: 'loading' });
        // Isolated from the main bootstrap: a missing finance/prefs migration must not block tasks.
        void get().loadFinancePreference();
        void get().loadUiPreferences();

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

        // ---- 追いつき同期（resync）の状態 ----
        // 論理チャンネルごとの購読状態。「切断→再購読」を検出して差分取得を起動する。
        const realtimeHealth = createRealtimeHealth();
        // 直近の完全同期（初期ロード / resync）で受け取った tasks の最大 updated_at。
        // Realtime 経由の行では前進させない（lib/sync/resync.ts の taskWatermarkFrom を参照）。
        let taskWatermark: string | null = null;
        let lastResyncAt = 0;
        let resyncInFlight: Promise<void> | null = null;
        let resyncQueued = false;
        let resyncDebounce: ReturnType<typeof setTimeout> | null = null;
        const channelRecreateTimers = new Map<string, ReturnType<typeof setTimeout>>();
        const channelRecreateAttempts = new Map<string, number>();
        const pendingTaskSyncs = new Map<string, ReturnType<typeof setTimeout>>();

        const refreshInitialState = async () => {
            // ロード開始時点で必ず未ロード状態にする。ユーザー切替時は resetStore を経由しない
            // 経路があるため（setUser で user だけ差し替わる）、ここでも明示的に落とす。
            // これが false の間は getMergedTasks が仮想ルーチンタスクを合成しないため、
            // 「routines だけ載って tasks が空」の窓での実体行上書き（データ破壊）が起きない。
            set({ tasksLoaded: false });

            try {
                // Start tags + tasks together (fetchTasks accepts a tags promise so the
                // paged tasks query is not blocked behind a serial tags round-trip).
                // Keep main's 2-phase UX: light data paints first; tasks stream in later.
                const tagsPromise = fetchTags(supabase);
                const tasksPromise = fetchTasks(supabase, tagsPromise);
                // 軽量フェーズが先に throw / return した場合に unhandled rejection にならないよう、
                // ハンドラだけ先に張っておく（実際の await は後段で行い、そこで catch される）。
                tasksPromise.catch(() => {});

                // --- Fast phase: 軽いデータを取得して即描画 ---
                const [tags, routines, sections, projects, goals, notes, itemTemplates] = await Promise.all([
                    tagsPromise,
                    fetchRoutines(supabase),
                    fetchSections(supabase),
                    fetchProjects(supabase),
                    fetchGoals(supabase),
                    fetchNotes(supabase),
                    fetchItemTemplates(supabase),
                ]);

                if (disposed) {
                    return;
                }

                rebuildDataSubscriptions(
                    projects.map((project) => project.id)
                );

                // tasks キーを含めないことで、ローカルの楽観的（pending）タスクを潰さない。
                set({
                    tags,
                    routines,
                    sections: sortSections(sections),
                    projects,
                    goals,
                    itemTemplates,
                    dailyNotes: notes.dailyNotes,
                    weeklyNotes: notes.weeklyNotes,
                    monthlyNotes: notes.monthlyNotes,
                    yearlyNotes: notes.yearlyNotes,
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
                        // オンボーディング後は再帰呼び出しが最新の tasks まで set() する。
                        // ここで return しないと、オンボーディング前に投げた（古い）tasksPromise が
                        // 後から解決して新しいタスクを上書きしてしまう。
                        await refreshInitialState();
                        return;
                    }
                }

                // --- Slow phase: tasks が揃い次第あとから流し込む ---
                let tasks;
                try {
                    tasks = await tasksPromise;
                } catch (error) {
                    // タスク取得の失敗を握り潰さない。ここで tasksLoaded を true にすると
                    // 「タスク0件で読み込み完了」＝仮想ルーチンタスクが実体行を上書きし得る
                    // 最も危険な状態になるため、必ず false のままにしてユーザーに通知する。
                    console.error('Failed to fetch tasks:', error);
                    if (!disposed) {
                        set({ initialDataStatus: 'error' });
                        get().showToast(
                            'タスクの読み込みに失敗しました。通信環境を確認して、ページを再読み込みしてください。',
                            'error'
                        );
                    }
                    return;
                }

                if (disposed) {
                    return;
                }

                set((state) => ({
                    tasks: replaceWithFullTaskList(state.tasks, tasks, isPendingTask),
                    // tasks が実際に着弾したこの set() でのみ true にする。
                    // 以降 getMergedTasks は仮想ルーチンタスクの合成を再開する。
                    tasksLoaded: true,
                    initialDataStatus: 'ready',
                }));

                // 初期ロードは完全同期なので、以降の差分取得の起点にする。
                taskWatermark = taskWatermarkFrom(tasks, null);
                lastResyncAt = Date.now();
                realtimeHealth.settle();
            } catch (error) {
                console.error('Failed to refresh Supabase state:', error);
                if (!disposed) {
                    set({ initialDataStatus: 'error' });
                    get().showToast(
                        'データの読み込みに失敗しました。通信環境を確認して、ページを再読み込みしてください。',
                        'error'
                    );
                }
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
                // Task deletion cascades finance rows. Another device's delete still
                // has to drop the amounts from the open day and week totals.
                get().markFinanceSummariesStale();
                rebuildDataSubscriptions(
                    get().projects.map((project) => project.id)
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
                    get().projects.map((project) => project.id)
                );
            } catch (error) {
                console.error('Failed to sync task:', error);
            }
        };

        // Realtime のタスクイベントを ID ごとに短くまとめてから syncTask へ渡す。
        // 削除は即時（取り消す対象のタイマーがあれば捨てる）。INSERT/UPDATE は最後のイベント種別で 1 回だけ取得する。
        const queueTaskSync = (taskId: string, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => {
            if (disposed) {
                return;
            }
            const pending = pendingTaskSyncs.get(taskId);
            if (pending) {
                clearTimeout(pending);
                pendingTaskSyncs.delete(taskId);
            }
            if (eventType === 'DELETE') {
                void syncTask(taskId, 'DELETE');
                return;
            }
            pendingTaskSyncs.set(
                taskId,
                setTimeout(() => {
                    pendingTaskSyncs.delete(taskId);
                    void syncTask(taskId, eventType);
                }, TASK_SYNC_COALESCE_MS)
            );
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
            key: 'tags' | 'sections' | 'routines' | 'goals' | 'itemTemplates',
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

            if (key === 'itemTemplates') {
                const mapped = mapper(row as never) as unknown as ItemTemplate;
                set((state) => ({
                    itemTemplates:
                        payload.eventType === 'DELETE'
                            ? state.itemTemplates.filter((template) => template.id !== row.id)
                            : upsertById(state.itemTemplates, mapped),
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

        const rebuildDataSubscriptions = (projectIds: string[]) => {
            if (disposed) {
                return;
            }

            // IDの集合を正規化（重複排除＋ソート）し、フィルタ文字列を安定化させる。
            // 並び順の違いだけで無駄な差し替えが起きないようにするため。
            const sortedProjectIds = Array.from(new Set(projectIds)).sort();

            // 購読対象IDの集合が前回と同一なら、全フィルタが不変なので張り直し不要。
            // syncTask が INSERT/UPDATE/DELETE のたびに rebuild を呼んでも、
            // 実際にIDの集合が変化した時だけ以降の差分処理が走る（チャーン抑制）。
            const subscriptionSignature = sortedProjectIds.join(',');
            if (subscriptionSignature === lastSubscriptionSignature && dataChannels.size > 0) {
                return;
            }
            lastSubscriptionSignature = subscriptionSignature;

            const projectFilter = buildInFilter('id', sortedProjectIds);
            const projectScopedFilter = buildInFilter('project_id', sortedProjectIds);

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
                // 購読状態は「このチャンネルが今も現役か」を確認してから扱う。張り替えで破棄した
                // 旧チャンネルの CLOSED を切断と誤認しないため（参照比較で判定する）。
                let handle: ReturnType<typeof subscribeTable> | null = null;
                const channel = subscribeTable(
                    supabase,
                    `${key}:g${channelTopicGeneration}`,
                    table,
                    onChange,
                    filter,
                    (status, error) => {
                        if (disposed || dataChannels.get(key)?.channel !== handle) {
                            return;
                        }
                        handleChannelStatus(key, status, error, () => {
                            // 待っている間に通常の張り替えで新しいチャンネルになっていたら何もしない
                            if (dataChannels.get(key)?.channel === handle) {
                                recreateDataChannel(key);
                            }
                        });
                    }
                );
                handle = channel;
                nextChannels.set(key, { channel, filter });
            };

            ensureChannel(
                `tags:${user.uid}`,
                'tags',
                (payload) => syncCollectionItem('tags', mapTag, payload),
                `user_id=eq.${user.uid}`
            );
            ensureChannel(
                `item-templates:${user.uid}`,
                'item_templates',
                (payload) => syncCollectionItem('itemTemplates', mapItemTemplate, payload),
                `user_id=eq.${user.uid}`
            );
            ensureChannel(
                `tasks:personal:${user.uid}`,
                'tasks',
                (payload) => queueTaskSync((payload.new?.id ?? payload.old?.id) as string, payload.eventType),
                `user_id=eq.${user.uid}`
            );
            if (projectScopedFilter) {
                ensureChannel(
                    `tasks:projects:${user.uid}`,
                    'tasks',
                    (payload) => queueTaskSync((payload.new?.id ?? payload.old?.id) as string, payload.eventType),
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
                    queueTaskSync(taskId, payload.eventType === 'DELETE' ? 'UPDATE' : payload.eventType);
                },
                // RLS on task_tags already limits events to accessible tasks.
                // Avoid a multi-thousand-UUID Realtime filter, which exceeds
                // protocol limits on migrated accounts.
                undefined
            );

            // 今回の購読対象から外れた論理キー（例: 全プロジェクト離脱で projectScoped 系が消えた）を破棄する。
            for (const [key, entry] of previousChannels) {
                if (!nextChannels.has(key)) {
                    staleChannels.push(entry.channel);
                    realtimeHealth.forget(key);
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

        // サーバー側で閉じられた（CLOSED）データチャンネルを、同じ論理キーで張り直す。
        // realtime-js は CLOSED になったチャンネルを socket から外し自動では再参加しないため、
        // 放置するとそのテーブルの Realtime だけが静かに止まる。
        const recreateDataChannel = (key: string) => {
            if (disposed) {
                return;
            }
            const entry = dataChannels.get(key);
            if (!entry) {
                return;
            }
            dataChannels.delete(key);
            void unsubscribeChannels(supabase, [entry.channel]);
            // シグネチャ短絡を外し、欠けたキーだけを ensureChannel に新規生成させる
            // （フィルタが同じ他のチャンネルはそのまま引き継がれる）。
            lastSubscriptionSignature = null;
            rebuildDataSubscriptions(get().projects.map((project) => project.id));
        };

        const handleChannelStatus = (
            key: string,
            status: SubscribeStatus,
            error: Error | undefined,
            recreate: () => void
        ) => {
            if (disposed) {
                return;
            }
            const outcome = realtimeHealth.report(key, status);
            if (status === 'SUBSCRIBED') {
                channelRecreateAttempts.delete(key);
                if (outcome === 'recovered') {
                    // 切断中のイベントは再送されないので、差分を取りに行って埋める。
                    scheduleResync('realtime-reconnect');
                }
                return;
            }
            if (status === 'CLOSED') {
                const attempt = channelRecreateAttempts.get(key) ?? 0;
                channelRecreateAttempts.set(key, attempt + 1);
                const delay = CHANNEL_RECREATE_DELAYS_MS[Math.min(attempt, CHANNEL_RECREATE_DELAYS_MS.length - 1)];
                const existingTimer = channelRecreateTimers.get(key);
                if (existingTimer) {
                    clearTimeout(existingTimer);
                }
                channelRecreateTimers.set(
                    key,
                    setTimeout(() => {
                        channelRecreateTimers.delete(key);
                        recreate();
                    }, delay)
                );
                return;
            }
            // CHANNEL_ERROR / TIMED_OUT: realtime-js が自動で再参加を試みる。成功すれば SUBSCRIBED
            // （recovered）が届いて差分取得が走る。ここではログだけ残す。
            if (error) {
                console.warn(`[realtime] ${key}: ${status}`, error);
            }
        };

        const scheduleResync = (reason: ResyncReason) => {
            if (resyncDebounce) {
                clearTimeout(resyncDebounce);
            }
            resyncDebounce = setTimeout(() => {
                resyncDebounce = null;
                void resyncFromServer(reason);
            }, RESYNC_DEBOUNCE_MS);
        };

        // 追いつき同期の本体。軽いコレクションは全件、tasks はウォーターマーク以降の差分だけを取る。
        const runResync = async (reason: ResyncReason) => {
            try {
                // 期限切れトークンのまま PostgREST を叩くと anon 扱いで「0 行」が返り、
                // それを削除照合に使うとローカルのタスクを全部落としてしまう。
                // getSession() はリフレッシュ完了まで待つので、ここでセッションを確定させる。
                const {
                    data: { session },
                } = await supabase.auth.getSession();
                if (disposed || !session || session.user.id !== user.uid) {
                    return;
                }

                const tagsPromise = fetchTags(supabase);
                const [tags, routines, sections, projects, goals, notes, itemTemplates] = await Promise.all([
                    tagsPromise,
                    fetchRoutines(supabase),
                    fetchSections(supabase),
                    fetchProjects(supabase),
                    fetchGoals(supabase),
                    fetchNotes(supabase),
                    fetchItemTemplates(supabase),
                ]);
                if (disposed) {
                    return;
                }

                rebuildDataSubscriptions(projects.map((project) => project.id));
                set({
                    tags,
                    routines,
                    sections: sortSections(sections),
                    projects,
                    goals,
                    itemTemplates,
                    dailyNotes: notes.dailyNotes,
                    weeklyNotes: notes.weeklyNotes,
                    monthlyNotes: notes.monthlyNotes,
                    yearlyNotes: notes.yearlyNotes,
                });

                let changed = 0;
                let removed = 0;
                const watermark = taskWatermark;
                const delta = watermark
                    ? await fetchTasksUpdatedSince(supabase, watermarkQueryBound(watermark), tags)
                    : null;
                if (disposed) {
                    return;
                }

                if (!delta || !delta.complete) {
                    // 起点が無い（初回ロードが 0 件だった）か、差分が 1 ページに収まらない: 全件取り直す。
                    const tasks = await fetchTasks(supabase, tags);
                    if (disposed) {
                        return;
                    }
                    set((state) => ({ tasks: replaceWithFullTaskList(state.tasks, tasks, isPendingTask) }));
                    taskWatermark = taskWatermarkFrom(tasks, watermark);
                    changed = tasks.length;
                } else {
                    // 削除は差分クエリに現れないので、今日と表示日付の周辺について ID を突き合わせる。
                    const window = resyncDateWindow(formatLocalDate(), get().currentDate);
                    let presentIds: Set<string> | null = null;
                    try {
                        presentIds = new Set(await fetchTaskIdsBetween(supabase, window.from, window.to));
                    } catch (error) {
                        console.warn('[resync] task id reconciliation skipped:', error);
                    }
                    if (disposed) {
                        return;
                    }
                    set((state) => {
                        const merged = mergeResyncedTasks(state.tasks, delta.tasks, isPendingTask);
                        if (!presentIds) {
                            return { tasks: merged };
                        }
                        const reconciled = reconcileMissingTasks(merged, presentIds, window, isPendingTask);
                        removed = reconciled.removed;
                        return { tasks: reconciled.tasks };
                    });
                    taskWatermark = taskWatermarkFrom(delta.tasks, watermark);
                    changed = delta.tasks.length;
                }

                if (changed > 0 || removed > 0) {
                    // 金額の合計は DB 側で集計しているので、タスクが動いたら取り直させる。
                    get().markFinanceSummariesStale();
                }
                lastResyncAt = Date.now();
                realtimeHealth.settle();
                set({ lastResyncAt });
            } catch (error) {
                // 失敗しても手元のデータは保ち、次の復帰 / 再接続でまた試す。
                console.warn(`[resync:${reason}] failed:`, error);
            }
        };

        const resyncFromServer = async (reason: ResyncReason): Promise<void> => {
            if (disposed || get().user?.uid !== user.uid) {
                return;
            }
            const status = get().initialDataStatus;
            if (status === 'error') {
                // 初期ロードに失敗したまま復帰した: 差分ではなく最初からやり直す。
                await refreshInitialState();
                return;
            }
            if (status !== 'ready') {
                // 初期ロード中 / 未開始。ロード自体が最新を持ってくる。
                return;
            }
            if (resyncInFlight) {
                // 実行中に別のトリガが来たら、終わった後にもう 1 回だけ回す（取りこぼし防止）。
                resyncQueued = true;
                return resyncInFlight;
            }
            resyncInFlight = runResync(reason).finally(() => {
                resyncInFlight = null;
                if (resyncQueued && !disposed) {
                    resyncQueued = false;
                    void resyncFromServer('queued');
                }
            });
            return resyncInFlight;
        };

        const subscribeMembership = () => {
            channelTopicGeneration += 1;
            let handle: ReturnType<typeof subscribeTable> | null = null;
            const channel = subscribeTable(
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
                        get().projects.map((project) => project.id)
                    );
                },
                `user_id=eq.${user.uid}`,
                (status, error) => {
                    if (disposed || membershipChannel !== handle) {
                        return;
                    }
                    handleChannelStatus('project-members', status, error, () => {
                        if (disposed || membershipChannel !== handle) {
                            return;
                        }
                        membershipChannel = null;
                        void unsubscribeChannels(supabase, [channel]);
                        subscribeMembership();
                    });
                }
            );
            handle = channel;
            membershipChannel = channel;
        };

        void refreshInitialState();
        void get().fetchBillingInfo();
        rebuildDataSubscriptions(
            get().projects.map((project) => project.id)
        );
        subscribeMembership();

        // フォアグラウンド復帰 / オンライン復帰 / bfcache 復元で差分を取りに行く。
        // Android アプリ（WebView）がバックグラウンドで WebSocket を失っても、
        // 戻ってきた瞬間に Web 側の変更が反映されるようにする。
        const stopForegroundWatch = watchForegroundReturns({
            onVisible: (hiddenForMs) => {
                if (
                    !shouldResyncOnVisible({
                        hiddenForMs,
                        interrupted: realtimeHealth.interrupted,
                        sinceLastResyncMs: Date.now() - lastResyncAt,
                    })
                ) {
                    return;
                }
                void resyncFromServer('foreground');
            },
            onOnline: () => void resyncFromServer('online'),
            onRestore: () => void resyncFromServer('pageshow'),
        });
        activeResync = resyncFromServer;

        set({
            unsubscribe: () => {
                disposed = true;
                if (activeResync === resyncFromServer) {
                    activeResync = null;
                }
                stopForegroundWatch();
                if (resyncDebounce) {
                    clearTimeout(resyncDebounce);
                    resyncDebounce = null;
                }
                channelRecreateTimers.forEach((timer) => clearTimeout(timer));
                channelRecreateTimers.clear();
                pendingTaskSyncs.forEach((timer) => clearTimeout(timer));
                pendingTaskSyncs.clear();
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
