import { generateText, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import { format } from 'date-fns';
import { getDb } from '@/lib/firebaseAdmin';
import { checkQuota, incrementRequestCount, recordTokenUsage } from '@/lib/billing/usage';
import { buildWorkspaceReplyPrompt } from '@/lib/ai/workspacePrompts';
import { createWorkspaceTools } from '@/lib/ai/workspaceTools';
import admin from 'firebase-admin';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError, jsonError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { taskIdRequestSchema } from '@/lib/validations/task';

const MODEL = 'gemini-2.5-flash';

export async function POST(req: Request) {
  console.log('==== AI Workspace Reply API Called ====');
  try {
    const { uid } = await requireAuth(req);

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

    const { taskId } = await parseJsonBody(req, taskIdRequestSchema);

    const db = getDb();

    // 3. タスク取得 + 所有権チェック
    const taskDoc = await db.collection('tasks').doc(taskId).get();
    if (!taskDoc.exists || taskDoc.data()?.userId !== uid) {
      return jsonError('Task not found', 404);
    }

    const taskData = taskDoc.data()!;

    // 4. コメント履歴を取得（最新20件）
    const commentsSnapshot = await db
      .collection('tasks')
      .doc(taskId)
      .collection('comments')
      .orderBy('createdAt', 'asc')
      .limitToLast(20)
      .get();

    const commentThread = commentsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        authorType: data.authorType as 'user' | 'ai',
        authorName: data.authorName,
        content: data.content,
        createdAt: data.createdAt,
      };
    });

    const today = format(new Date(), 'yyyy-MM-dd');

    // 5. AI応答生成
    const systemPrompt = buildWorkspaceReplyPrompt({
      currentDate: today,
      taskTitle: taskData.title,
      taskMemo: taskData.memo,
      commentThread,
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
          content: '上記の会話の文脈を踏まえて応答してください。',
        },
      ],
      tools,
      stopWhen: stepCountIs(5),
    });

    // 6. トークン使用量を記録
    if (result.usage) {
      recordTokenUsage(uid, result.usage.inputTokens || 0, result.usage.outputTokens || 0);
    }

    // 7. AI応答をコメントとして投稿
    if (result.text && result.text.trim()) {
      const now = Date.now();
      const commentRef = db.collection('tasks').doc(taskId).collection('comments').doc();

      const comment = {
        id: commentRef.id,
        taskId,
        userId: uid,
        authorType: 'ai',
        authorName: 'Taskel AI',
        content: result.text,
        createdAt: now,
        updatedAt: now,
      };

      const batch = db.batch();
      batch.set(commentRef, comment);
      batch.update(db.collection('tasks').doc(taskId), {
        commentCount: admin.firestore.FieldValue.increment(1),
        updatedAt: now,
      });
      await batch.commit();

      return new Response(
        JSON.stringify({ comment }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ message: 'No response generated' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return handleApiError('Workspace Reply API Error', error);
  }
}
