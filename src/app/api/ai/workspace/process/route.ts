import { generateText, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import { format } from 'date-fns';
import { getAuth, getDb } from '@/lib/firebaseAdmin';
import { checkQuota, incrementRequestCount, recordTokenUsage } from '@/lib/billing/usage';
import { buildWorkspaceProcessPrompt } from '@/lib/ai/workspacePrompts';
import { createWorkspaceTools } from '@/lib/ai/workspaceTools';

const MODEL = 'gemini-2.5-flash';

export async function POST(req: Request) {
  console.log('==== AI Workspace Process API Called ====');
  try {
    // 1. Bearer token認証
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.split('Bearer ')[1];
    let uid: string;
    try {
      const decoded = await getAuth().verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. クォータチェック
    const quota = await checkQuota(uid);
    if (!quota.allowed) {
      return new Response(
        JSON.stringify({
          error: 'quota_exceeded',
          plan: quota.plan,
          used: quota.used,
          limit: quota.limit,
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await incrementRequestCount(uid);

    const { taskId } = await req.json();
    if (!taskId) {
      return new Response(JSON.stringify({ error: 'taskId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb();

    // 3. タスク取得 + 所有権チェック
    const taskDoc = await db.collection('tasks').doc(taskId).get();
    if (!taskDoc.exists || taskDoc.data()?.userId !== uid) {
      return new Response(JSON.stringify({ error: 'Task not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const taskData = taskDoc.data()!;

    // 4. ステータスを processing に更新
    await db.collection('tasks').doc(taskId).update({
      aiStatus: 'processing',
      updatedAt: Date.now(),
    });

    const today = format(new Date(), 'yyyy-MM-dd');

    // 5. AI処理実行
    try {
      const systemPrompt = buildWorkspaceProcessPrompt({
        currentDate: today,
        taskTitle: taskData.title,
        taskMemo: taskData.memo,
        taskTags: taskData.tags,
      });

      const tools = createWorkspaceTools({
        userId: uid,
        taskId,
        currentDate: today,
      });

      const result = await generateText({
        model: google(MODEL),
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `このタスクの処理を開始してください。タイトル「${taskData.title}」のメモに記載された指示に従って、分析・処理を行い、結果をpostCommentツールでコメントに投稿してください。`,
          },
        ],
        tools,
        stopWhen: stepCountIs(10),
      });

      // 6. トークン使用量を記録
      if (result.usage) {
        recordTokenUsage(uid, result.usage.inputTokens || 0, result.usage.outputTokens || 0);
      }

      // 7. AIのテキスト応答もコメントとして投稿（ツールでpostCommentしなかった場合）
      if (result.text && result.text.trim()) {
        const now = Date.now();
        const commentRef = db.collection('tasks').doc(taskId).collection('comments').doc();
        const batch = db.batch();
        batch.set(commentRef, {
          id: commentRef.id,
          taskId,
          userId: uid,
          authorType: 'ai',
          authorName: 'Taskel AI',
          content: result.text,
          createdAt: now,
          updatedAt: now,
        });
        const admin = await import('firebase-admin');
        batch.update(db.collection('tasks').doc(taskId), {
          commentCount: admin.default.firestore.FieldValue.increment(1),
          updatedAt: now,
        });
        await batch.commit();
      }

      // 8. ステータスを completed に更新
      await db.collection('tasks').doc(taskId).update({
        aiStatus: 'completed',
        aiCompletedAt: Date.now(),
        updatedAt: Date.now(),
      });

      return new Response(
        JSON.stringify({ status: 'completed', taskId }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (aiError) {
      console.error('AI processing error:', aiError);

      // エラー時のステータス更新
      const errorMessage = aiError instanceof Error ? aiError.message : 'Unknown AI error';
      await db.collection('tasks').doc(taskId).update({
        aiStatus: 'error',
        aiError: errorMessage,
        updatedAt: Date.now(),
      });

      return new Response(
        JSON.stringify({ status: 'error', error: errorMessage }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Workspace Process API Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
