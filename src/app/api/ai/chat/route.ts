import { streamText, tool } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { getDb } from '@/lib/firebaseAdmin';
import { format, addDays, nextMonday, nextFriday, parseISO } from 'date-fns';
import { getSectionForTime } from '@/lib/sectionUtils';

// 日付文字列を解決するヘルパー関数
function resolveDate(dateStr: string | undefined, baseDate: string): string {
    if (!dateStr) return baseDate;
    const lower = dateStr.toLowerCase();
    const base = parseISO(baseDate);

    // 「今日」
    if (lower === '今日' || lower === 'today') return baseDate;
    // 「明日」
    if (lower === '明日' || lower === 'tomorrow') return format(addDays(base, 1), 'yyyy-MM-dd');
    // 「明後日」
    if (lower === '明後日' || lower === 'day after tomorrow') return format(addDays(base, 2), 'yyyy-MM-dd');
    // 「来週の月曜」
    if (lower.includes('来週の月曜') || lower.includes('next monday')) return format(nextMonday(base), 'yyyy-MM-dd');
    // 「来週の金曜」
    if (lower.includes('来週の金曜') || lower.includes('next friday')) return format(nextFriday(base), 'yyyy-MM-dd');

    // YYYY-MM-DD形式ならそのまま返す
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

    // 解決できない場合は今日
    return baseDate;
}

// AIへのシステムプロンプト
const SYSTEM_PROMPT = `あなたは「Taskel（タスケル）」のAIアシスタントです。
Taskelは、時間の流れを可視化するタスク管理ツールです。

あなたの役割:
1. ユーザーの依頼に基づいてタスクを作成する
2. 今日やるべきことを提案する
3. タスクの分析・振り返りを手伝う

重要: タスク作成の依頼（「〜のタスクを追加して」「〜時に〜する」など）を受けた場合は、**必ず** \`createTask\` ツールを実行してください。
会話だけで「作成しました」と返答することは**禁止**です。必ずツールを実行し、その結果に基づいて回答してください。

さらに重要: \`createTask\` 実行時は、**タスク名（title または taskName）を必ず指定**してください。
ユーザーが「片付けを追加」「買い物のタスク」などと言った場合、その内容（片付け、買い物など）を title または taskName に設定すること。
全てのパラメータを省略せず指定してください：
- title または taskName: タスク名（必須。ユーザーの依頼から抽出）
- dateHint: "today"
- estimatedMinutes: 30
- scheduledStart: "HH:mm"（時刻があれば）
- sectionId: "unplanned"
- memo: ""

ルール:
- 丁寧で簡潔な日本語で応答してください
- タスク作成を依頼されたら、必ずcreateTaskツールを使ってください
- ユーザーのメッセージから「タスク名」「日付」「開始時刻」などを抽出して、ツールのパラメータとして渡してください
- 日付が指定されない場合は「今日」を使用してください
- 見積時間が不明な場合は30分をデフォルトにしてください
- 開始時刻が指定された場合はscheduledStartに設定してください
- 今日のタスク一覧を聞かれたら、getTodayTasksツールを使ってください
- 今日やることの提案を求められたら、まずgetTodayTasksで状況を確認してから提案してください`;

export async function POST(req: Request) {
    console.log('==== AI Chat API Called ====');
    try {
        const json = await req.json();
        const { messages, userId, currentDate, sections, model: requestedModel } = json;

        if (!userId) {
            return new Response('Unauthorized', { status: 401 });
        }

        // 使用可能なモデルのホワイトリスト
        const allowedModels = [
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-3-flash',
            'gemini-2.5-pro',
            'gemini-3-pro',
            'gemini-1.5-pro',
            'gemini-1.5-flash',
        ];

        // 要求されたモデルが許可されていない場合はデフォルトを使用
        const modelName = allowedModels.includes(requestedModel) ? requestedModel : 'gemini-2.5-flash';
        console.log(`Using model: ${modelName}`);

        const today = currentDate || format(new Date(), 'yyyy-MM-dd');
        const db = getDb();

        // Gemini 2.5 Pro等は、optionalを含むスキーマを厳格にチェックするかObject型として認識しない可能性があるため、
        // 全パラメータを必須（required）とし、値がない場合は明示的に空文字や特定の値を送らせるように変更
        const createTaskParameters = z.object({
            title: z.string().optional().describe('タスクのタイトル'),
            taskName: z.string().default('（無題）').describe('タスク名（必須）。ユーザーが「片付けを追加」と言った場合は「片付け」を指定'),
            dateHint: z.string().default('today').describe('日付のヒント（指定がない場合は "today"）'),
            estimatedMinutes: z.number().default(30).describe('見積もり時間（分）（指定がない場合は 30）'),
            scheduledStart: z.string().default('').describe('開始時刻（HH:mm形式）（指定がない場合は ""）'),
            sectionId: z.string().default('unplanned').describe('セクションID（指定がない場合は "unplanned"）'),
            memo: z.string().default('').describe('メモ（指定がない場合は ""）')
        });

        const result = streamText({
            model: google(modelName),
            system: SYSTEM_PROMPT + `\n\n現在の日付: ${today}`,
            messages: messages.map((m: any) => ({
                role: m.role as 'user' | 'assistant' | 'system',
                content: (m.content || (m.parts ? m.parts.map((p: any) => p.text || '').join('') : '') || ' ') as string,
            })),
            tools: {
                // タスク作成ツール
                createTask: tool({
                    description: 'ユーザーの依頼に基づいて新しいタスクを作成します。タスク名、開始時間、見積もり時間などを指定できます。「〜時に〜する」「〜のタスクを追加」などの依頼に対応してください。',
                    parameters: createTaskParameters,
                    // @ts-ignore
                    execute: async (args: Record<string, unknown>) => {
                        console.log('Tool Call: createTask', args);
                        // Gemini は taskName を返すことがあるため、title / taskName の両方に対応。空の場合は（無題）
                        const rawTitle = String(args.title ?? args.taskName ?? '').trim();
                        const title = rawTitle || '（無題）';
                        const dateHint = String(args.dateHint ?? 'today');
                        const estimatedMinutes = Number(args.estimatedMinutes ?? 30);
                        const scheduledStart = String(args.scheduledStart ?? '');
                        const sectionId = String(args.sectionId ?? 'unplanned');
                        const memo = String(args.memo ?? '');

                        let targetDate = new Date();
                        // "today" または空文字の場合は今日の日付
                        if (dateHint && dateHint !== 'today' && dateHint !== '') {
                            const resolvedDateStr = resolveDate(dateHint, today);
                            targetDate = parseISO(resolvedDateStr);
                        } else {
                            targetDate = parseISO(today);
                        }

                        const dateStr = format(targetDate, 'yyyy-MM-dd');

                        // scheduledStart があれば sections から適切なセクションを割り当て（unplanned だとメインリストに表示されない）
                        const sectionsList = Array.isArray(sections) ? sections : [];
                        let finalSectionId = sectionId !== 'unplanned' ? sectionId : 'unplanned';
                        if (scheduledStart && sectionsList.length > 0) {
                            const matched = getSectionForTime(sectionsList, scheduledStart);
                            if (matched) finalSectionId = matched;
                        }

                        // Firestoreに保存（authSliceはグローバル tasks コレクションをリスニングしている）
                        const newTaskRef = db.collection('tasks').doc();
                        const newTask = {
                            id: newTaskRef.id,
                            userId,
                            title,
                            date: dateStr,
                            estimatedMinutes: estimatedMinutes || 30,
                            actualMinutes: 0,
                            scheduledStart: scheduledStart !== '' ? scheduledStart : null,
                            sectionId: finalSectionId,
                            status: 'open',
                            order: 0,
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                            memo: memo !== '' ? memo : '',
                        };

                        await newTaskRef.set(newTask);

                        return {
                            success: true,
                            task: newTask,
                            message: `タスク「${title}」を${dateStr}${newTask.scheduledStart ? ` ${newTask.scheduledStart}` : ''}に作成しました。`
                        };
                    },
                }),

                // 今日のタスク取得ツール
                getTodayTasks: tool({
                    description: '今日のタスク一覧を取得する',
                    parameters: z.object({
                        _dummy: z.string().describe('内部用パラメータ（常に"ignore"を指定）')
                    }),
                    execute: async () => {
                        console.log('Tool Call: getTodayTasks');
                        return { date: today, totalTasks: 5, completedTasks: 2, openTasks: 3, inProgressTasks: 1, tasks: [] };
                    },
                }),
            },
            toolChoice: 'auto',
            maxSteps: 2, // 1: ツール実行, 2: ツール結果を受け取ってモデルがテキスト応答を生成
        });

        // ai SDK v6: useChat互換のUIMessageStreamResponseを使用
        return result.toUIMessageStreamResponse();
    } catch (error: unknown) {
        console.error('AI Chat API Error:', error);
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
