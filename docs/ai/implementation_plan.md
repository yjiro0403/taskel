# Implementation Plan: Phase 1 - AI Sidebar & Core Components

## 概要

Phase 1では、既存の`AIChatPanel.tsx`（307行）と`route.ts`（201行）をリファクタリングし、以下を実現する:

1. **コード整理**: システムプロンプト・ツール定義・ヘルパー関数の外部化
2. **TaskCreationCard**: AI提案タスクの確認UIの新規実装（User Agency原則）
3. **getTodayTasksツールの完全実装**: ダミーデータから実Firestoreクエリへ
4. **AISliceの拡張**: タスク候補の状態管理

現在のcreateTaskツールは直接Firestoreに書き込んでおり、User Agency原則に違反している。Phase 1完了後は、AIが提案したタスクをTaskCreationCardでプレビューし、ユーザーが確認・修正した後にのみDBに反映されるフローに変更する。

---

## ファイル構成

### 新規作成ファイル

| ファイル | 責務 |
|---|---|
| `src/lib/ai/prompts.ts` | システムプロンプトの定義・組み立て |
| `src/lib/ai/tools.ts` | AIツール定義（createTask, getTodayTasks）|
| `src/lib/ai/types.ts` | AI関連の型定義（TaskCandidate等）|
| `src/lib/ai/dateResolver.ts` | 日付文字列の解決ヘルパー（route.tsから抽出）|
| `src/components/ai/TaskCreationCard.tsx` | タスク候補のプレビュー・編集・確定UI |
| `src/components/ai/ChatMessage.tsx` | 個別メッセージの表示コンポーネント |
| `src/components/ai/ChatInput.tsx` | チャット入力フォーム |
| `src/components/ai/ModelSelector.tsx` | モデル選択ドロップダウン |

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/components/AIChatPanel.tsx` | サブコンポーネントへの分割、TaskCreationCard統合 |
| `src/app/api/ai/chat/route.ts` | プロンプト・ツール・ヘルパーの外部化、createTask→提案モードへ変更 |
| `src/store/slices/aiSlice.ts` | TaskCandidate状態管理の追加 |
| `src/store/types.ts` | AISlice型の更新 |
| `CLAUDE.md` | AI関連設計情報の追記 |

---

## データフロー設計

### 現在のフロー（問題あり）
```
User Input → AI Analysis → createTask Tool → Firestore直接書き込み → 通知
```
ユーザーの確認なしにDBに書き込まれるため、User Agency原則に違反。

### Phase 1完了後のフロー
```
User Input
  → AI Analysis (Server: route.ts)
  → Tool Result: TaskCandidate JSON（DBには書き込まない）
  → Client: TaskCreationCard表示
  → User: 内容確認・編集
  → User: 「作成」ボタン押下
  → Client: Zustand addTask() → BFF API /api/tasks → Firestore
```

### シーケンス図（テキスト表現）
```
User        AIChatPanel     route.ts         TaskCreationCard    Zustand/BFF
 |              |               |                   |                |
 |--message---->|               |                   |                |
 |              |--POST-------->|                   |                |
 |              |               |--streamText------>|                |
 |              |               |  (tool: suggestTask)              |
 |              |               |--TaskCandidate--->|                |
 |              |<--stream------|                   |                |
 |              |--render------>|                   |                |
 |              |          TaskCreationCard表示      |                |
 |--edit/confirm--------------->|                   |                |
 |              |               |    addTaskCandidate()              |
 |              |               |                   |--confirmTask-->|
 |              |               |                   |   addTask()    |
 |              |               |                   |    POST /api/tasks
 |              |               |                   |                |--Firestore
```

---

## 型定義設計（`src/lib/ai/types.ts`）

```typescript
/**
 * AIが提案するタスクの候補データ。
 * DBには保存されず、ユーザーの確認を経てTask型に変換される。
 */
export interface TaskCandidate {
  /** フロントエンドで一意に識別するための一時ID（crypto.randomUUID()） */
  tempId: string;
  /** タスクのタイトル */
  title: string;
  /** 対象日（YYYY-MM-DD形式） */
  date: string;
  /** 見積もり時間（分） */
  estimatedMinutes: number;
  /** 開始時刻（HH:mm形式、任意） */
  scheduledStart?: string;
  /** セクションID */
  sectionId: string;
  /** メモ */
  memo?: string;
  /** 紐づけるGoalのID（任意） */
  parentGoalId?: string;
  /** 紐づけるProjectのID（任意） */
  projectId?: string;
  /** AIが付与したタグ */
  aiTags?: string[];
  /** 候補の状態 */
  status: 'pending' | 'confirmed' | 'dismissed';
  /** この候補を生成したチャットメッセージのID */
  sourceMessageId?: string;
}

/**
 * getTodayTasksツールの戻り値の型
 */
export interface TodayTasksSummary {
  date: string;
  totalTasks: number;
  completedTasks: number;
  openTasks: number;
  inProgressTasks: number;
  totalEstimatedMinutes: number;
  totalActualMinutes: number;
  tasks: TaskSummaryItem[];
}

export interface TaskSummaryItem {
  id: string;
  title: string;
  status: string;
  estimatedMinutes: number;
  actualMinutes: number;
  scheduledStart?: string;
  sectionId: string;
  parentGoalId?: string;
}
```

---

## API設計（`src/app/api/ai/chat/route.ts` リファクタ）

### リファクタ方針

現在のroute.tsは201行で、以下が全て同一ファイルに含まれている:
- `resolveDate` ヘルパー関数
- `SYSTEM_PROMPT` 定数（30行のハードコード）
- `createTaskParameters` zodスキーマ
- `createTask` ツール実装（Firestore直接書き込み）
- `getTodayTasks` ツール実装（ダミーデータ返却）

リファクタ後のroute.tsは以下のみを担当する:
- リクエストのパース・バリデーション
- モデル選択
- 外部モジュールの組み立て
- `streamText` の呼び出しとレスポンス返却

### route.ts リファクタ後の構造（疑似コード）

```typescript
import { streamText } from 'ai';
import { google } from '@ai-sdk/google';
import { buildSystemPrompt } from '@/lib/ai/prompts';
import { createAITools } from '@/lib/ai/tools';

export async function POST(req: Request) {
  const json = await req.json();
  const { messages, userId, currentDate, sections, model: requestedModel } = json;

  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const modelName = resolveModel(requestedModel);
  const today = currentDate || format(new Date(), 'yyyy-MM-dd');

  const result = streamText({
    model: google(modelName),
    system: buildSystemPrompt({ currentDate: today }),
    messages: normalizeMessages(messages),
    tools: createAITools({ userId, currentDate: today, sections }),
    toolChoice: 'auto',
    maxSteps: 2,
  });

  return result.toUIMessageStreamResponse();
}
```

---

## ツール定義設計（`src/lib/ai/tools.ts`）

### suggestTask ツール（createTaskから名称変更）

**重要な設計変更**: `createTask` から `suggestTask` に名称を変更し、Firestore書き込みを行わず、候補データのみを返却する。

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { resolveDate } from './dateResolver';
import { getSectionForTime } from '@/lib/sectionUtils';
import { Section } from '@/types';

interface ToolContext {
  userId: string;
  currentDate: string;
  sections: Section[];
}

export function createAITools(context: ToolContext) {
  return {
    suggestTask: tool({
      description: 'ユーザーの依頼に基づいてタスクの作成を提案します。' +
        'タスクの内容をプレビューカードとして表示し、ユーザーの確認を待ちます。' +
        '直接作成はせず、提案のみを行います。',
      parameters: suggestTaskSchema,
      execute: async (args) => {
        // TaskCandidate JSONを組み立てて返す（DB書き込みなし）
        const title = (args.title || args.taskName || '').trim() || '(無題)';
        const date = resolveDate(args.dateHint, context.currentDate);
        const estimatedMinutes = args.estimatedMinutes || 30;
        const scheduledStart = args.scheduledStart || undefined;
        const memo = args.memo || '';

        // セクション自動割り当て
        let sectionId = args.sectionId || 'unplanned';
        if (scheduledStart && context.sections.length > 0) {
          const matched = getSectionForTime(context.sections, scheduledStart);
          if (matched) sectionId = matched;
        }

        return {
          type: 'task_suggestion' as const,
          candidate: {
            tempId: crypto.randomUUID(),
            title,
            date,
            estimatedMinutes,
            scheduledStart: scheduledStart || null,
            sectionId,
            memo,
            parentGoalId: args.parentGoalId || null,
            projectId: args.projectId || null,
            aiTags: args.aiTags || [],
            status: 'pending',
          },
          message: `タスク「${title}」を提案します。内容を確認して、問題なければ作成ボタンを押してください。`,
        };
      },
    }),

    getTodayTasks: tool({
      description: '今日のタスク一覧を取得して、現在の状況を把握します',
      parameters: z.object({
        _dummy: z.string().describe('内部用パラメータ（常に"ignore"を指定）'),
      }),
      execute: async () => {
        // 実際にFirestoreから取得する（Phase 1で完全実装）
        // ... 詳細は後述
      },
    }),
  };
}
```

### suggestTask パラメータスキーマ

```typescript
const suggestTaskSchema = z.object({
  title: z.string().optional().describe('タスクのタイトル'),
  taskName: z.string().default('(無題)').describe(
    'タスク名（必須）。ユーザーが「片付けを追加」と言った場合は「片付け」を指定'
  ),
  dateHint: z.string().default('today').describe(
    '日付のヒント（"today", "明日", "2025-01-15" 等）'
  ),
  estimatedMinutes: z.number().default(30).describe('見積もり時間（分）'),
  scheduledStart: z.string().default('').describe('開始時刻（HH:mm形式）'),
  sectionId: z.string().default('unplanned').describe('セクションID'),
  memo: z.string().default('').describe('メモ'),
  parentGoalId: z.string().optional().describe('紐づける目標のID'),
  projectId: z.string().optional().describe('紐づけるプロジェクトのID'),
  aiTags: z.array(z.string()).optional().describe('AIが推定するタグ'),
});
```

### getTodayTasks 完全実装

```typescript
// tools.ts 内
getTodayTasks: tool({
  description: '今日のタスク一覧を取得して、現在の状況を把握します',
  parameters: z.object({
    _dummy: z.string().describe('内部用パラメータ（常に"ignore"を指定）'),
  }),
  execute: async () => {
    const db = getDb();
    const snapshot = await db
      .collection('tasks')
      .where('userId', '==', context.userId)
      .where('date', '==', context.currentDate)
      .get();

    const tasks = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title,
        status: data.status,
        estimatedMinutes: data.estimatedMinutes || 0,
        actualMinutes: data.actualMinutes || 0,
        scheduledStart: data.scheduledStart || null,
        sectionId: data.sectionId || 'unplanned',
        parentGoalId: data.parentGoalId || null,
      };
    });

    const completedTasks = tasks.filter((t) => t.status === 'done').length;
    const openTasks = tasks.filter((t) => t.status === 'open').length;
    const inProgressTasks = tasks.filter((t) => t.status === 'in_progress').length;
    const totalEstimatedMinutes = tasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
    const totalActualMinutes = tasks.reduce((sum, t) => sum + t.actualMinutes, 0);

    return {
      date: context.currentDate,
      totalTasks: tasks.length,
      completedTasks,
      openTasks,
      inProgressTasks,
      totalEstimatedMinutes,
      totalActualMinutes,
      tasks: tasks.filter((t) => t.status !== 'skipped'),
    };
  },
}),
```

---

## 日付解決ヘルパー（`src/lib/ai/dateResolver.ts`）

route.tsの `resolveDate` 関数をそのまま外部化する。変更なし。

```typescript
import { format, addDays, nextMonday, nextFriday, parseISO } from 'date-fns';

/**
 * 自然言語やヒント文字列を YYYY-MM-DD 形式に解決する。
 * 解決できない場合は baseDate を返す。
 */
export function resolveDate(dateStr: string | undefined, baseDate: string): string {
  if (!dateStr) return baseDate;
  const lower = dateStr.toLowerCase();
  const base = parseISO(baseDate);

  if (lower === '今日' || lower === 'today') return baseDate;
  if (lower === '明日' || lower === 'tomorrow') return format(addDays(base, 1), 'yyyy-MM-dd');
  if (lower === '明後日' || lower === 'day after tomorrow') return format(addDays(base, 2), 'yyyy-MM-dd');
  if (lower.includes('来週の月曜') || lower.includes('next monday')) return format(nextMonday(base), 'yyyy-MM-dd');
  if (lower.includes('来週の金曜') || lower.includes('next friday')) return format(nextFriday(base), 'yyyy-MM-dd');

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  return baseDate;
}
```

---

## プロンプト設計（`src/lib/ai/prompts.ts`）

### 設計方針
- 関数型: `buildSystemPrompt(context)` で動的に組み立てる
- セクション分離: ペルソナ、ルール、ツール使用ガイド、コンテキストを明確に分ける
- 拡張性: Phase 2以降でコンテキスト情報（今日のタスク要約等）を追加できる構造

```typescript
interface PromptContext {
  currentDate: string;
  /** Phase 2以降で追加: 今日のタスク要約、Goals情報等 */
}

export function buildSystemPrompt(context: PromptContext): string {
  return [
    PERSONA_SECTION,
    RULES_SECTION,
    TOOL_GUIDE_SECTION,
    buildContextSection(context),
  ].join('\n\n');
}

const PERSONA_SECTION = `あなたは「Taskel（タスケル）」のAIアシスタントです。
Taskelは、時間の流れを可視化し、「Single Active Task」に集中するためのタスク管理ツールです。
あなたの役割はユーザーのタスク管理を「提案」によってサポートすることです。
最終決定権は常にユーザーにあります（User Agency）。`;

const RULES_SECTION = `## ルール
- 丁寧で簡潔な日本語で応答してください
- タスク作成を依頼されたら、必ず suggestTask ツールを使ってタスクを「提案」してください
- 提案したタスクは確認カードとしてユーザーに表示されます。勝手にDBに書き込むことはありません
- ユーザーのメッセージから「タスク名」「日付」「開始時刻」「見積もり時間」を抽出して、ツールのパラメータとして渡してください
- 日付が指定されない場合は「今日」を使用してください
- 見積もり時間が不明な場合は30分をデフォルトにしてください。ただし、一般的な知見から適切な見積もりを提案することを推奨します
- 開始時刻が指定された場合は scheduledStart に設定してください
- 今日のタスク一覧を聞かれたら、getTodayTasks ツールを使ってください
- 今日やることの提案を求められたら、まず getTodayTasks で状況を確認してから提案してください`;

const TOOL_GUIDE_SECTION = `## ツール使用ガイド
### suggestTask
タスクの作成提案に使用します。「〜のタスクを追加して」「〜時に〜する」などの依頼に対応してください。
全てのパラメータを省略せず指定してください:
- title または taskName: タスク名（必須。ユーザーの依頼から抽出）
- dateHint: "today"（デフォルト）
- estimatedMinutes: 30（デフォルト）
- scheduledStart: "HH:mm"（時刻があれば）
- sectionId: "unplanned"（デフォルト）
- memo: ""

### getTodayTasks
今日のタスク状況を確認する際に使用します。`;

function buildContextSection(context: PromptContext): string {
  return `## 現在のコンテキスト
- 現在の日付: ${context.currentDate}`;
}
```

---

## コンポーネント設計

### TaskCreationCard（`src/components/ai/TaskCreationCard.tsx`）

#### 設計思想
- AIが提案したタスクのプレビュー・編集・確定を行うインラインカード
- チャットメッセージのツール結果部分に表示される
- 「User Agency」原則: 確定ボタンを押すまでDBには書き込まない
- 既存の`Task`型・`addTask`アクションとの整合性を維持

#### Props

```typescript
interface TaskCreationCardProps {
  candidate: TaskCandidate;
  onConfirm: (candidate: TaskCandidate) => void;
  onDismiss: (tempId: string) => void;
  onEdit: (tempId: string, updates: Partial<TaskCandidate>) => void;
}
```

#### 内部State

```typescript
// 編集モードの切り替え
const [isEditing, setIsEditing] = useState(false);
// 編集中のローカル値（確定前）
const [editValues, setEditValues] = useState<Partial<TaskCandidate>>({});
```

#### UIレイアウト

```
+---------------------------------------------------+
| [Sparkles icon] タスクの提案                        |
+---------------------------------------------------+
|                                                     |
|  タイトル:  [資料作成               ] [edit icon]   |
|  日付:      [2025-01-15            ]                |
|  開始時刻:  [15:00                 ]                |
|  見積もり:  [30分                  ]                |
|  メモ:      [会議用の資料          ]                |
|                                                     |
|  +----------+  +----------+                         |
|  |  作成    |  | キャンセル |                        |
|  +----------+  +----------+                         |
+---------------------------------------------------+
```

#### 状態遷移

```
pending → (ユーザーが「作成」) → confirmed → addTask() 呼び出し → UI更新
pending → (ユーザーが「キャンセル」) → dismissed → カード非表示
pending → (ユーザーが「編集」) → editing → (修正後) → pending
```

#### イベントハンドリング

```typescript
// 確定時: TaskCandidate → Task型に変換してZustand addTask()を呼ぶ
const handleConfirm = () => {
  const mergedCandidate = { ...candidate, ...editValues };
  onConfirm(mergedCandidate);
};

// TaskCandidate → Task変換（AISliceまたはAIChatPanel内で実施）
function candidateToTask(candidate: TaskCandidate, userId: string): Task {
  return {
    id: crypto.randomUUID(),
    userId,
    title: candidate.title,
    date: candidate.date,
    estimatedMinutes: candidate.estimatedMinutes,
    actualMinutes: 0,
    scheduledStart: candidate.scheduledStart,
    sectionId: candidate.sectionId,
    status: 'open',
    order: 0,
    memo: candidate.memo,
    parentGoalId: candidate.parentGoalId,
    projectId: candidate.projectId,
    aiTags: candidate.aiTags,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
```

#### スタイリング
- Tailwind CSS統一
- ダーク/ライトモード対応（`dark:` プレフィックス）
- カード枠: `border-indigo-200 dark:border-indigo-800` でAI提案であることを視覚的に示す
- 確定ボタン: `bg-indigo-600 hover:bg-indigo-700 text-white`
- キャンセルボタン: `bg-zinc-100 dark:bg-zinc-800 text-zinc-600`

### ChatMessage（`src/components/ai/ChatMessage.tsx`）

AIChatPanel.tsxから抽出する個別メッセージコンポーネント。

```typescript
interface ChatMessageProps {
  message: UIMessage;  // @ai-sdk/react のUIMessage型
  onTaskConfirm: (candidate: TaskCandidate) => void;
  onTaskDismiss: (tempId: string) => void;
  onTaskEdit: (tempId: string, updates: Partial<TaskCandidate>) => void;
}
```

責務:
- `role === 'user'` / `role === 'assistant'` によるスタイル分岐
- `parts` 配列のパース（text, tool-suggestTask, tool-getTodayTasks）
- ツール結果内の `type === 'task_suggestion'` を検出して TaskCreationCard をレンダリング
- ツール結果内の getTodayTasks 結果をテーブル/リスト形式で表示

### ChatInput（`src/components/ai/ChatInput.tsx`）

```typescript
interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  placeholder?: string;
}
```

### ModelSelector（`src/components/ai/ModelSelector.tsx`）

```typescript
interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
}

const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
] as const;
```

---

## 状態管理設計（Zustand AISlice 拡張）

### 現在のAISlice

```typescript
export interface AISlice {
  isAIPanelOpen: boolean;
  toggleAIPanel: () => void;
  setAIPanelOpen: (open: boolean) => void;
}
```

### 拡張後のAISlice

```typescript
import { TaskCandidate } from '@/lib/ai/types';
import { Task } from '@/types';

export interface AISlice {
  // --- 既存 ---
  isAIPanelOpen: boolean;
  toggleAIPanel: () => void;
  setAIPanelOpen: (open: boolean) => void;

  // --- Phase 1 新規 ---
  /** AIが提案したタスク候補のリスト */
  taskCandidates: TaskCandidate[];
  /** 候補を追加（AIツール結果からの呼び出し） */
  addTaskCandidate: (candidate: TaskCandidate) => void;
  /** 候補を編集 */
  updateTaskCandidate: (tempId: string, updates: Partial<TaskCandidate>) => void;
  /** 候補を確定してTaskとして追加（addTaskを内部で呼ぶ） */
  confirmTaskCandidate: (tempId: string) => Promise<void>;
  /** 候補を破棄 */
  dismissTaskCandidate: (tempId: string) => void;
  /** 全候補をクリア */
  clearTaskCandidates: () => void;
}
```

### 実装

```typescript
export const createAISlice: StateCreator<StoreState, [], [], AISlice> = (set, get) => ({
  // --- 既存 ---
  isAIPanelOpen: false,
  toggleAIPanel: () => set((state) => ({ isAIPanelOpen: !state.isAIPanelOpen })),
  setAIPanelOpen: (open) => set({ isAIPanelOpen: open }),

  // --- Phase 1 新規 ---
  taskCandidates: [],

  addTaskCandidate: (candidate) =>
    set((state) => ({
      taskCandidates: [...state.taskCandidates, { ...candidate, status: 'pending' }],
    })),

  updateTaskCandidate: (tempId, updates) =>
    set((state) => ({
      taskCandidates: state.taskCandidates.map((c) =>
        c.tempId === tempId ? { ...c, ...updates } : c
      ),
    })),

  confirmTaskCandidate: async (tempId) => {
    const { taskCandidates, addTask, user } = get();
    const candidate = taskCandidates.find((c) => c.tempId === tempId);
    if (!candidate || !user) return;

    // TaskCandidate → Task 変換
    const newTask: Task = {
      id: crypto.randomUUID(),
      userId: user.uid,
      title: candidate.title,
      date: candidate.date,
      estimatedMinutes: candidate.estimatedMinutes,
      actualMinutes: 0,
      scheduledStart: candidate.scheduledStart,
      sectionId: candidate.sectionId,
      status: 'open',
      order: 0,
      memo: candidate.memo,
      parentGoalId: candidate.parentGoalId,
      projectId: candidate.projectId,
      aiTags: candidate.aiTags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 候補のステータスを更新
    set((state) => ({
      taskCandidates: state.taskCandidates.map((c) =>
        c.tempId === tempId ? { ...c, status: 'confirmed' as const } : c
      ),
    }));

    // 既存のaddTask（BFFパターン）でFirestoreに保存
    await addTask(newTask);
  },

  dismissTaskCandidate: (tempId) =>
    set((state) => ({
      taskCandidates: state.taskCandidates.map((c) =>
        c.tempId === tempId ? { ...c, status: 'dismissed' as const } : c
      ),
    })),

  clearTaskCandidates: () => set({ taskCandidates: [] }),
});
```

### store/types.ts の変更

`AISlice` のインポート元は既に `./slices/aiSlice` になっているため、型の変更は自動的に反映される。追加の変更は不要。

---

## AIChatPanel.tsx リファクタ設計

### リファクタ方針
- 307行のモノリスから、責務ごとのサブコンポーネントに分割
- AIChatPanel自体は「コンテナコンポーネント」として残す（レイアウト + useChat統合）
- ツール結果のパースロジックをChatMessage内に移動
- TaskCreationCardのレンダリングをChatMessage内で行う

### リファクタ後のAIChatPanel構造

```tsx
export const AIChatPanel: React.FC = () => {
  const { isAIPanelOpen, toggleAIPanel, user, currentDate, sections,
          addTaskCandidate, confirmTaskCandidate, dismissTaskCandidate,
          updateTaskCandidate, taskCandidates } = useStore();

  const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');

  const { messages, sendMessage, status } = useChat({
    api: '/api/ai/chat',
    body: { userId: user?.uid, model: selectedModel, currentDate, sections },
    onError: (error) => { console.error('Chat error:', error); },
    maxSteps: 5,
    // ツール結果からTaskCandidateを抽出してストアに追加
    onToolResult: ({ toolName, result }) => {
      if (result?.type === 'task_suggestion' && result?.candidate) {
        addTaskCandidate(result.candidate);
      }
    },
  });

  // ... (handleSubmit等)

  return (
    <>
      <AnimatePresence>
        {isAIPanelOpen && (
          <>
            {/* Overlay */}
            <motion.div ... />

            <motion.div className="fixed right-0 ...">
              {/* Header with ModelSelector */}
              <Header>
                <ModelSelector value={selectedModel} onChange={setSelectedModel} />
              </Header>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto ...">
                {messages.map((m) => (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    onTaskConfirm={(candidate) => confirmTaskCandidate(candidate.tempId)}
                    onTaskDismiss={(tempId) => dismissTaskCandidate(tempId)}
                    onTaskEdit={(tempId, updates) => updateTaskCandidate(tempId, updates)}
                  />
                ))}
              </div>

              {/* Input */}
              <ChatInput ... />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* FAB */}
      ...
    </>
  );
};
```

### ツール結果からTaskCandidateへの橋渡し

`useChat` の `onToolResult` コールバック（もしAI SDK v6に存在する場合）、または `messages` のリアクティブ監視で、ツール結果に `type: 'task_suggestion'` が含まれていたら `addTaskCandidate` を呼ぶ。

AI SDK v6の `useChat` に `onToolResult` がない場合は、`useEffect` で `messages` を監視し、新しいツール結果を検出する:

```typescript
useEffect(() => {
  // 最新のassistantメッセージからtask_suggestionを検出
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant?.parts) return;

  for (const part of lastAssistant.parts) {
    if (part.type?.startsWith('tool-') && part.state === 'output-available') {
      const output = part.output as any;
      if (output?.type === 'task_suggestion' && output?.candidate) {
        const candidate = output.candidate as TaskCandidate;
        // 重複チェック
        const exists = taskCandidates.some(c => c.tempId === candidate.tempId);
        if (!exists) {
          addTaskCandidate(candidate);
        }
      }
    }
  }
}, [messages]);
```

---

## 実装手順（Devエージェント向けステップバイステップ）

### Step 1: AI型定義の作成
**ファイル**: `src/lib/ai/types.ts`
**作業内容**: `TaskCandidate`, `TodayTasksSummary`, `TaskSummaryItem` 型を定義
**検証**: TypeScriptコンパイルが通ること

### Step 2: 日付解決ヘルパーの外部化
**ファイル**: `src/lib/ai/dateResolver.ts`
**作業内容**: `route.ts` から `resolveDate` 関数をコピーして独立モジュール化
**検証**: 既存のテストがあれば通ること、なければ手動で日付解決を確認

### Step 3: システムプロンプトの外部化
**ファイル**: `src/lib/ai/prompts.ts`
**作業内容**: `buildSystemPrompt` 関数を実装。`route.ts` の `SYSTEM_PROMPT` を移植・改善
**重要**: ツール名を `createTask` → `suggestTask` に変更。「提案」モードを反映するプロンプトに変更
**検証**: `buildSystemPrompt({ currentDate: '2025-01-15' })` が正しい文字列を返すこと

### Step 4: ツール定義の外部化
**ファイル**: `src/lib/ai/tools.ts`
**作業内容**:
  - `createAITools(context)` 関数を実装
  - `suggestTask` ツール: TaskCandidate JSONを返す（Firestore書き込みなし）
  - `getTodayTasks` ツール: 実際のFirestoreクエリで今日のタスクを取得
**検証**: ツール定義がzodスキーマとして正しいこと

### Step 5: route.ts のリファクタ
**ファイル**: `src/app/api/ai/chat/route.ts`
**作業内容**:
  - `resolveDate`, `SYSTEM_PROMPT`, ツール定義を外部モジュールのインポートに置き換え
  - メッセージの正規化ロジックをヘルパー関数に抽出
  - 不要になったコードを削除
**検証**: `npm run build` が通ること。AIチャットが動作すること

### Step 6: AISliceの拡張
**ファイル**: `src/store/slices/aiSlice.ts`
**作業内容**: `taskCandidates` 状態と関連アクション（add, update, confirm, dismiss, clear）を追加
**検証**: Zustandストアが正しく動作すること（`useStore.getState()` でtaskCandidatesにアクセスできること）

### Step 7: TaskCreationCardの実装
**ファイル**: `src/components/ai/TaskCreationCard.tsx`
**作業内容**:
  - Props定義
  - プレビュー表示（タイトル、日付、時刻、見積もり、メモ）
  - 編集モード（各フィールドをinput/selectに切り替え）
  - 確定・キャンセルボタン
  - Tailwind CSSでダーク/ライトモード対応
**検証**: Storybookでの表示確認（可能であれば）

### Step 8: ChatMessage / ChatInput / ModelSelectorの抽出
**ファイル**: `src/components/ai/ChatMessage.tsx`, `src/components/ai/ChatInput.tsx`, `src/components/ai/ModelSelector.tsx`
**作業内容**: AIChatPanel.tsxから各コンポーネントを抽出。ChatMessage内でTaskCreationCardをレンダリング
**検証**: AIChatPanel.tsxと同じ見た目・挙動であること

### Step 9: AIChatPanel.tsxのリファクタ
**ファイル**: `src/components/AIChatPanel.tsx`
**作業内容**:
  - サブコンポーネント（ChatMessage, ChatInput, ModelSelector）のインポートに置き換え
  - TaskCandidate検出ロジックの追加（useEffect）
  - onConfirm/onDismiss/onEditハンドラの実装
  - 不要になったインラインコードを削除
**検証**: AIチャットで「タスクを追加して」と入力 → TaskCreationCardが表示 → 確定でタスクが作成されること

### Step 10: CLAUDE.mdの更新
**ファイル**: `CLAUDE.md`
**作業内容**: AI関連の設計情報を追記
  - `src/lib/ai/` ディレクトリの説明
  - `src/components/ai/` ディレクトリの説明
  - データフロー（User Input → AI Suggestion → User Confirmation → Firestore Write）の詳細化
**検証**: ドキュメントが正確であること

### Step 11: 統合テスト
**作業内容**:
  1. `npm run build` が通ること
  2. 以下の手動テストシナリオを実施:
     - AIチャットで「明日15時に会議」→ TaskCreationCard表示 → 確定 → Firestoreにタスク作成
     - AIチャットで「明日15時に会議」→ TaskCreationCard表示 → タイトル編集 → 確定
     - AIチャットで「明日15時に会議」→ TaskCreationCard表示 → キャンセル → タスク未作成
     - AIチャットで「今日のタスクは？」→ 実際のタスク一覧が返却される
     - 見積もり時間未指定時のデフォルト30分の確認
     - セクション自動割り当ての確認

---

## 注意点・制約

### 既存コードとの整合性

1. **BFFパターンの維持**: タスク作成は `addTask()` → `/api/tasks` → Firestore の既存フローを利用する。AI側で直接Firestoreに書き込まない
2. **Firestore リスナー**: `authSlice.ts` の `onSnapshot` リスナーが `tasks` コレクションを監視しているため、`addTask` 経由でFirestoreに書き込めば自動的にUIに反映される
3. **仮想タスク**: `getMergedTasks` のルーティン由来仮想タスクのロジックには影響しない
4. **国際化**: `next-intl` による翻訳に対応すべきだが、Phase 1ではハードコード日本語で実装し、Phase 2以降で翻訳キーに置き換える

### パフォーマンス

1. **getTodayTasks のクエリ**: `userId` + `date` でフィルタするため、既存の Firestore インデックスで対応可能。複合インデックスが必要な場合は作成する
2. **TaskCandidate のメモリ管理**: セッション中に大量の候補が蓄積されないよう、confirmed/dismissed の候補は一定時間後にクリアする（Phase 2で対応）

### AI SDK v6 の互換性

1. **ツール名変更の影響**: `createTask` → `suggestTask` への変更で、既存のチャット履歴のツール結果表示が壊れる可能性がある。ただし、チャット履歴はセッションベースで永続化していないため影響は限定的
2. **parts 配列のパース**: AI SDK v6の `UIMessage.parts` 配列内のツール結果のpart typeは `tool-{toolName}` 形式で自動生成される。`suggestTask` に変更すると `tool-suggestTask` になる
3. **maxSteps**: 現在 `route.ts` で `maxSteps: 2`、`useChat` で `maxSteps: 5` が設定されている。サーバー側の `maxSteps: 2` は「1: ツール実行, 2: テキスト応答生成」で適切。クライアント側は複数ツール呼び出しに対応するため `5` のまま維持

### セキュリティ

1. **userId の検証**: 現在は `req.body.userId` をそのまま使用している。Phase 2以降でFirebase Auth トークン検証を追加すべきだが、Phase 1では現状維持
2. **Firestore Rules**: `getTodayTasks` はサーバーサイド（Admin SDK）で実行されるため、Firestore Security Rulesの影響を受けない

---

## Phase 2 への接続点

Phase 1完了後、以下の機能追加がスムーズに行えるよう設計している:

1. **Goal紐づけ**: `TaskCandidate.parentGoalId` フィールドは既に定義済み。TaskCreationCardにGoal選択UIを追加するだけ
2. **見積もり時間のキャリブレーション**: `getTodayTasks` が `actualMinutes` を返却するため、AIが見積もり精度を分析可能
3. **コンテキスト拡張**: `buildSystemPrompt` の `PromptContext` インターフェースに `todaySummary`, `activeGoals` 等のフィールドを追加するだけ
4. **複数タスク一括提案**: `taskCandidates` は配列で管理しているため、Goal Breakdownで複数タスクを一度に提案可能
