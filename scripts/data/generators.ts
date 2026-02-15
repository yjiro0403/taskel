import { addDays, format, subDays, startOfWeek, endOfWeek, eachDayOfInterval, getISOWeek } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

// --- Types ---
interface TaskTemplate {
    title: string;
    sectionId: string;
    estimatedMinutes: number;
    tags?: string[];
}

interface DemoScenario {
    profile: string;
    sections: { id: string; name: string; order: number; startTime?: string; endTime?: string }[];
    routines: { title: string; frequency: 'daily' | 'weekly'; sectionId: string; estimatedMinutes: number; tags?: string[] }[];
    taskTemplates: {
        morning: string[];
        day: string[];
        night: string[];
    };
    notes: {
        daily: string;
        weekly: string;
        monthly: string;
        yearly: string;
    };
    projects: { id: string; title: string; description: string; status: 'active' | 'completed' | 'archived' }[];
    tags: { id: string; name: string; color: string; memo?: string }[];
    milestones: { projectId: string; id: string; title: string; description?: string; startDate?: string; endDate?: string; order: number; status: 'open' | 'in_progress' | 'done' }[];
    goals: {
        yearly: { id: string; title: string; description?: string; projectId?: string; priority: 1 | 2 | 3 | 4 | 5 }[];
        monthly: { id: string; title: string; parentGoalId?: string; projectId?: string; priority: 1 | 2 | 3 | 4 | 5 }[];
        weekly: { id: string; title: string; parentGoalId?: string; projectId?: string; priority: 1 | 2 | 3 | 4 | 5 }[];
    };
}

// --- Deterministic IDs for cross-referencing ---
const PROJECT_IDS = {
    taskelRelease: 'proj-taskel-release',
    clientA: 'proj-client-a',
};

const TAG_IDS = {
    dev: 'tag-dev',
    mtg: 'tag-mtg',
    office: 'tag-office',
    learning: 'tag-learning',
    health: 'tag-health',
};

const GOAL_IDS = {
    yearlyProduct: 'goal-y-product',
    yearlyBlog: 'goal-y-blog',
    monthlyBeta: 'goal-m-beta',
    monthlyTalk: 'goal-m-talk',
    monthlyRead: 'goal-m-read',
    weeklyApi: 'goal-w-api',
    weeklyTest: 'goal-w-test',
    weeklyBlog: 'goal-w-blog',
};

const MILESTONE_IDS = {
    taskelAlpha: 'ms-taskel-alpha',
    taskelBeta: 'ms-taskel-beta',
    clientDelivery: 'ms-client-delivery',
    clientReview: 'ms-client-review',
};

// --- Scenarios ---
export const demoScenario: DemoScenario = {
    profile: "フリーランスエンジニア（30代・リモートワーク）",
    sections: [
        { id: 'section-morning', name: 'Morning Routine (Start ~ 9:00)', order: 0, endTime: '09:00' },
        { id: 'section-work', name: 'Deep Work (9:00 ~ 18:00)', order: 1, startTime: '09:00', endTime: '18:00' },
        { id: 'section-night', name: 'Evening & Review (18:00 ~ End)', order: 2, startTime: '18:00' }
    ],
    routines: [
        { title: '朝のコーヒー & ニュースチェック', frequency: 'daily', sectionId: 'section-morning', estimatedMinutes: 15 },
        { title: 'デイリープランニング', frequency: 'daily', sectionId: 'section-morning', estimatedMinutes: 10 },
        { title: 'メールチェック・Slack返信', frequency: 'daily', sectionId: 'section-work', estimatedMinutes: 30, tags: [TAG_IDS.office] },
        { title: '週次レビュー', frequency: 'weekly', sectionId: 'section-night', estimatedMinutes: 45 },
    ],
    taskTemplates: {
        morning: [
            'ジムで筋トレ', '瞑想 (10分)', '読書', 'ゴミ出し'
        ],
        day: [
            'クライアントMTG資料作成', 'API設計レビュー', 'バグ修正: 認証エラー対応',
            '技術ブログ執筆', '経費精算', 'デザインレビュー', 'コードリファクタリング',
            '新規案件見積もり作成', 'ウェビナー視聴', 'ライブラリ選定調査',
            'PR レビュー対応', 'ドキュメント更新', 'テストケース作成'
        ],
        night: [
            '日次レビュー', '明日の予定確認', 'Netflixで映画鑑賞', 'ストレッチ', '友人との夕食'
        ]
    },
    notes: {
        daily: `# 今日の振り返り\n\n- [x] 朝のルーチン完了\n- [x] API設計のレビュー完了\n- [ ] バグ修正が難航した\n\n## 明日への申し送り\n- 午前中にAPI仕様を固める\n- テストケースを追加する`,
        weekly: `# 今週のハイライト\n\n## 達成目標\n- [x] Taskelリリース準備のα版完了\n- [x] ブログ記事1本公開\n- [ ] クライアントA案件のレビュー対応\n\n## 改善点\n- 見積もりの精度を上げる（実績との乖離が大きかった）\n- 睡眠時間を確保する`,
        monthly: `# 今月のテーマ: β版リリース\n\n## 目標\n- Taskelのβ版をリリースする\n- 登壇資料を仕上げる\n- 読書5冊達成\n\n## 振り返り\n- 新しいフレームワークのキャッチアップが進んだ\n- 健康診断にも行けた`,
        yearly: `# 2026年の抱負\n\n1. 個人開発プロダクト（Taskel）をリリース\n2. 技術ブログ50記事\n3. 登壇回数 5回以上\n4. フルマラソン完走`
    },
    projects: [
        {
            id: PROJECT_IDS.taskelRelease,
            title: 'Taskelリリース準備',
            description: '個人開発のタスク管理アプリ「Taskel」のリリースに向けた準備プロジェクト。\n\n## マイルストーン\n- α版: コア機能実装\n- β版: AI機能・Analytics追加',
            status: 'active',
        },
        {
            id: PROJECT_IDS.clientA,
            title: 'クライアントA案件',
            description: 'クライアントA社のWebアプリケーション開発案件。\n\nフロントエンド刷新 + API最適化。',
            status: 'active',
        },
    ],
    tags: [
        { id: TAG_IDS.dev, name: '開発', color: '#3B82F6', memo: 'コーディング・設計・レビュー関連' },
        { id: TAG_IDS.mtg, name: 'MTG', color: '#8B5CF6', memo: 'ミーティング・打ち合わせ' },
        { id: TAG_IDS.office, name: '事務', color: '#F59E0B', memo: '経費精算・メール・請求書' },
        { id: TAG_IDS.learning, name: '学習', color: '#10B981', memo: '読書・ウェビナー・勉強会' },
        { id: TAG_IDS.health, name: '健康', color: '#EF4444', memo: '運動・ストレッチ・健康管理' },
    ],
    milestones: [
        {
            projectId: PROJECT_IDS.taskelRelease,
            id: MILESTONE_IDS.taskelAlpha,
            title: 'α版: コア機能実装',
            description: 'タスクCRUD, タイムトラッキング, セクション管理の実装完了',
            startDate: '2026-01-01',
            endDate: '2026-01-31',
            order: 0,
            status: 'done',
        },
        {
            projectId: PROJECT_IDS.taskelRelease,
            id: MILESTONE_IDS.taskelBeta,
            title: 'β版: AI機能・Analytics追加',
            description: 'AIアシスタント, Analytics, Goals機能の追加',
            startDate: '2026-02-01',
            endDate: '2026-02-28',
            order: 1,
            status: 'in_progress',
        },
        {
            projectId: PROJECT_IDS.clientA,
            id: MILESTONE_IDS.clientDelivery,
            title: 'フロントエンド刷新',
            description: 'React移行 + デザインシステム導入',
            startDate: '2026-01-15',
            endDate: '2026-02-15',
            order: 0,
            status: 'in_progress',
        },
        {
            projectId: PROJECT_IDS.clientA,
            id: MILESTONE_IDS.clientReview,
            title: 'API最適化 & レビュー',
            description: 'パフォーマンス改善とセキュリティレビュー',
            startDate: '2026-02-16',
            endDate: '2026-03-15',
            order: 1,
            status: 'open',
        },
    ],
    goals: {
        yearly: [
            {
                id: GOAL_IDS.yearlyProduct,
                title: '個人開発プロダクトをリリース',
                description: 'Taskelを正式リリースし、ユーザー100人獲得を目指す',
                projectId: PROJECT_IDS.taskelRelease,
                priority: 5,
            },
            {
                id: GOAL_IDS.yearlyBlog,
                title: '技術ブログ50記事',
                description: '週1ペースで技術記事を公開する。Next.js, AI, Firebase系の内容を中心に。',
                priority: 4,
            },
        ],
        monthly: [
            {
                id: GOAL_IDS.monthlyBeta,
                title: 'β版リリース',
                parentGoalId: GOAL_IDS.yearlyProduct,
                projectId: PROJECT_IDS.taskelRelease,
                priority: 5,
            },
            {
                id: GOAL_IDS.monthlyTalk,
                title: '登壇資料準備',
                priority: 3,
            },
            {
                id: GOAL_IDS.monthlyRead,
                title: '読書5冊',
                priority: 2,
            },
        ],
        weekly: [
            {
                id: GOAL_IDS.weeklyApi,
                title: 'API設計完了',
                parentGoalId: GOAL_IDS.monthlyBeta,
                projectId: PROJECT_IDS.taskelRelease,
                priority: 5,
            },
            {
                id: GOAL_IDS.weeklyTest,
                title: 'ユーザーテスト実施',
                parentGoalId: GOAL_IDS.monthlyBeta,
                projectId: PROJECT_IDS.taskelRelease,
                priority: 4,
            },
            {
                id: GOAL_IDS.weeklyBlog,
                title: 'ブログ2記事',
                parentGoalId: GOAL_IDS.yearlyBlog,
                priority: 3,
            },
        ],
    },
};

// --- Tag assignment mapping for task titles ---
const taskTagMapping: Record<string, string[]> = {
    'ジムで筋トレ': [TAG_IDS.health],
    '瞑想 (10分)': [TAG_IDS.health],
    'ストレッチ': [TAG_IDS.health],
    '読書': [TAG_IDS.learning],
    'ウェビナー視聴': [TAG_IDS.learning],
    'ライブラリ選定調査': [TAG_IDS.learning],
    'クライアントMTG資料作成': [TAG_IDS.mtg, TAG_IDS.office],
    'API設計レビュー': [TAG_IDS.dev],
    'バグ修正: 認証エラー対応': [TAG_IDS.dev],
    '技術ブログ執筆': [TAG_IDS.dev, TAG_IDS.learning],
    '経費精算': [TAG_IDS.office],
    'デザインレビュー': [TAG_IDS.dev, TAG_IDS.mtg],
    'コードリファクタリング': [TAG_IDS.dev],
    '新規案件見積もり作成': [TAG_IDS.office],
    'PR レビュー対応': [TAG_IDS.dev],
    'ドキュメント更新': [TAG_IDS.dev],
    'テストケース作成': [TAG_IDS.dev],
};

// --- Task-project mapping for realistic linking ---
const taskProjectMapping: Record<string, string> = {
    'API設計レビュー': PROJECT_IDS.taskelRelease,
    'コードリファクタリング': PROJECT_IDS.taskelRelease,
    'テストケース作成': PROJECT_IDS.taskelRelease,
    'ドキュメント更新': PROJECT_IDS.taskelRelease,
    'PR レビュー対応': PROJECT_IDS.taskelRelease,
    'クライアントMTG資料作成': PROJECT_IDS.clientA,
    'バグ修正: 認証エラー対応': PROJECT_IDS.clientA,
    'デザインレビュー': PROJECT_IDS.clientA,
};

// --- Task-goal mapping for weekly goals ---
const taskGoalMapping: Record<string, string> = {
    'API設計レビュー': GOAL_IDS.weeklyApi,
    'テストケース作成': GOAL_IDS.weeklyTest,
    '技術ブログ執筆': GOAL_IDS.weeklyBlog,
};

// --- Generators ---

const getRandomElement = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const generateSections = (userId: string) => {
    return demoScenario.sections.map(s => ({
        ...s,
        userId,
    }));
};

export const generateTags = (userId: string) => {
    return demoScenario.tags.map(t => ({
        ...t,
        userId,
    }));
};

export const generateProjects = (userId: string) => {
    return demoScenario.projects.map(p => ({
        ...p,
        userId,
        ownerId: userId,
        memberIds: [userId],
        roles: { [userId]: 'owner' as const },
        milestones: demoScenario.milestones.filter(m => m.projectId === p.id).map(({ projectId, ...m }) => m),
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }));
};

export const generateGoals = (userId: string, baseDate: Date = new Date()) => {
    const year = format(baseDate, 'yyyy');
    const month = format(baseDate, 'yyyy-MM');
    const weekNum = getISOWeek(baseDate);
    const week = `${year}-W${String(weekNum).padStart(2, '0')}`;

    const goals: any[] = [];

    // Yearly goals
    for (const g of demoScenario.goals.yearly) {
        goals.push({
            ...g,
            userId,
            type: 'yearly',
            assignedYear: year,
            status: 'in_progress',
            progress: Math.floor(Math.random() * 40) + 10, // 10-50
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    }

    // Monthly goals
    for (const g of demoScenario.goals.monthly) {
        goals.push({
            ...g,
            userId,
            type: 'monthly',
            assignedYear: year,
            assignedMonth: month,
            status: g.id === GOAL_IDS.monthlyBeta ? 'in_progress' : 'pending',
            progress: g.id === GOAL_IDS.monthlyBeta ? 65 : Math.floor(Math.random() * 30),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    }

    // Weekly goals
    for (const g of demoScenario.goals.weekly) {
        goals.push({
            ...g,
            userId,
            type: 'weekly',
            assignedYear: year,
            assignedMonth: month,
            assignedWeek: week,
            status: g.id === GOAL_IDS.weeklyApi ? 'in_progress' : 'pending',
            progress: g.id === GOAL_IDS.weeklyApi ? 80 : Math.floor(Math.random() * 50),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    }

    return goals;
};

export const generateRoutines = (userId: string) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return demoScenario.routines.map(r => ({
        id: uuidv4(),
        userId,
        ...r,
        active: true,
        startDate: today,
        nextRun: today,
        tags: r.tags || [],
    }));
};

export const generateTasks = (userId: string, baseDate: Date = new Date(), scale: 'normal' | 'large' = 'normal') => {
    const tasks: any[] = [];

    // Scale settings
    const rangeDays = scale === 'large' ? 15 : 3;
    const tasksPerDay = scale === 'large' ? 8 : 4;

    const startDate = subDays(baseDate, rangeDays);
    const endDate = addDays(baseDate, rangeDays);
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    days.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const isPast = day < baseDate;
        const isToday = format(day, 'yyyy-MM-dd') === format(baseDate, 'yyyy-MM-dd');

        const count = Math.floor(Math.random() * tasksPerDay) + (scale === 'large' ? 5 : 2);

        for (let i = 0; i < count; i++) {
            // Pick section logic: 20% morning, 60% day, 20% night
            const r = Math.random();
            let sectionType: 'morning' | 'day' | 'night' = 'day';
            let sectionId = 'section-work';

            if (r < 0.2) { sectionType = 'morning'; sectionId = 'section-morning'; }
            else if (r > 0.8) { sectionType = 'night'; sectionId = 'section-night'; }

            const title = getRandomElement(demoScenario.taskTemplates[sectionType]);

            // Status logic
            let status = 'open';
            if (isPast) {
                status = Math.random() > 0.1 ? 'done' : 'skipped';
            } else if (isToday) {
                status = Math.random() > 0.6 ? 'done' : (Math.random() > 0.3 ? 'in_progress' : 'open');
            }

            // Estimate and actual with variance for Analytics/Calibration appeal
            const estimatedMinutes = [15, 25, 30, 45, 60, 90, 120][Math.floor(Math.random() * 7)];
            let actualMinutes = 0;
            if (status === 'done') {
                // Add variance: actual can be 50%-180% of estimated
                const variance = 0.5 + Math.random() * 1.3;
                actualMinutes = Math.round(estimatedMinutes * variance);
            }

            // Lookup tags, project, goal from title
            const tags = taskTagMapping[title] || [];
            const projectId = taskProjectMapping[title] || undefined;
            const parentGoalId = taskGoalMapping[title] || undefined;

            tasks.push({
                id: uuidv4(),
                userId,
                title,
                sectionId,
                date: dateStr,
                status,
                estimatedMinutes,
                actualMinutes,
                order: i,
                tags,
                projectId,
                parentGoalId,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }
    });

    return tasks;
};

export const generateNotes = (userId: string, baseDate: Date = new Date()) => {
    const notes: any[] = [];

    // Daily Note (Today)
    notes.push({
        collection: 'dailyNotes',
        id: format(baseDate, 'yyyy-MM-dd'),
        userId,
        content: demoScenario.notes.daily,
        updatedAt: Date.now()
    });

    // Weekly Note (This Week)
    const weekNum = getISOWeek(baseDate);
    const weekId = format(baseDate, 'yyyy-') + 'W' + String(weekNum).padStart(2, '0');
    notes.push({
        collection: 'weeklyNotes',
        id: weekId,
        userId,
        content: demoScenario.notes.weekly,
        updatedAt: Date.now()
    });

    // Monthly Note
    const monthId = format(baseDate, 'yyyy-MM');
    notes.push({
        collection: 'monthlyNotes',
        id: monthId,
        userId,
        content: demoScenario.notes.monthly,
        updatedAt: Date.now()
    });

    // Yearly Note
    const yearId = format(baseDate, 'yyyy');
    notes.push({
        collection: 'yearlyNotes',
        id: yearId,
        userId,
        content: demoScenario.notes.yearly,
        updatedAt: Date.now()
    });

    return notes;
};
