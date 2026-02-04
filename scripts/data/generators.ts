import { addDays, format, subDays, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
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
    routines: { title: string; frequency: 'daily' | 'weekly'; sectionId: string; estimatedMinutes: number }[];
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
}

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
        { title: 'メールチェック・Slack返信', frequency: 'daily', sectionId: 'section-work', estimatedMinutes: 30 },
        { title: '週次レビュー', frequency: 'weekly', sectionId: 'section-night', estimatedMinutes: 45 },
    ],
    taskTemplates: {
        morning: [
            'ジムで筋トレ', '瞑想 (10分)', '読書', 'ゴミ出し'
        ],
        day: [
            'クライアントMTG資料作成', 'A社プロジェクト: API設計', 'B社プロジェクト: バグ修正',
            '技術ブログ執筆', '経費精算', 'デザインレビュー', 'コードリファクタリング',
            '新規案件見積もり作成', 'ウェビナー視聴', 'ライブラリ選定調査'
        ],
        night: [
            '日次レビュー', '明日の予定確認', 'Netflixで映画鑑賞', 'ストレッチ', '友人との夕食'
        ]
    },
    notes: {
        daily: `# 今日の振り返り\n\n- [x] 朝のルーチン完了\n- [ ] バグ修正が難航した\n\n## 明日への申し送り\n- 午前中にAPI仕様を固める`,
        weekly: `# 今週のハイライト\n\n## 達成目標\n- [ ] A社プロジェクトのマイルストーン達成\n- [x] ブログ記事1本公開\n\n## 改善点\n- 睡眠時間を確保する`,
        monthly: `# 今月のテーマ: 基礎固め\n\n- 新しいフレームワークのキャッチアップ\n- 健康診断に行く`,
        yearly: `# 2026年の抱負\n\n1. 売上前年比 120%\n2. 登壇回数 5回以上\n3. フルマラソン完走`
    }
};

// --- Generators ---

const getRandomElement = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const generateSections = (userId: string) => {
    return demoScenario.sections.map(s => ({
        ...s,
        userId,
        // Ensure ID is deterministic for linking tasks if needed, or widely usable
        // But for Firestore we might let it be auto-id or fixed 'section-morning' etc.
        // Let's keep the fixed ID for simplicity in task generation
    }));
};

export const generateTasks = (userId: string, baseDate: Date = new Date(), scale: 'normal' | 'large' = 'normal') => {
    const tasks: any[] = [];
    const sections = demoScenario.sections;

    // Scale settings
    const rangeDays = scale === 'large' ? 15 : 3; // +/- 15 days for large, 3 for normal
    const tasksPerDay = scale === 'large' ? 8 : 4;

    const startDate = subDays(baseDate, rangeDays);
    const endDate = addDays(baseDate, rangeDays);
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    days.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const isPast = day < baseDate;
        const isToday = format(day, 'yyyy-MM-dd') === format(baseDate, 'yyyy-MM-dd');

        // Generate tasks for this day
        // Randomly pick N tasks
        const count = Math.floor(Math.random() * tasksPerDay) + (scale === 'large' ? 5 : 2);

        for (let i = 0; i < count; i++) {
            // Pick section logic
            // 20% morning, 60% day, 20% night
            const r = Math.random();
            let sectionType: 'morning' | 'day' | 'night' = 'day';
            let sectionId = 'section-work';

            if (r < 0.2) { sectionType = 'morning'; sectionId = 'section-morning'; }
            else if (r > 0.8) { sectionType = 'night'; sectionId = 'section-night'; }

            const title = getRandomElement(demoScenario.taskTemplates[sectionType]);

            // Status logic
            let status = 'open';
            if (isPast) {
                // Past tasks mostly done, some skipped
                status = Math.random() > 0.1 ? 'done' : 'skipped';
            } else if (isToday) {
                status = Math.random() > 0.6 ? 'done' : (Math.random() > 0.3 ? 'in_progress' : 'open');
            }

            tasks.push({
                id: uuidv4(),
                userId,
                title: `${title} ${Math.floor(Math.random() * 100)}`, // Vary titles slightly
                sectionId,
                date: dateStr,
                status,
                estimatedMinutes: [15, 30, 45, 60, 90][Math.floor(Math.random() * 5)],
                actualMinutes: status === 'done' ? [15, 30, 45, 60][Math.floor(Math.random() * 4)] : 0,
                order: i,
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
    const weekId = format(baseDate, 'yyyy-') + 'W' + format(baseDate, 'ww');
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
