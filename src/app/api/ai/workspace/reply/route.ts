import { generateText, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import { format } from 'date-fns';
import { getAuth, getDb } from '@/lib/firebaseAdmin';
import { checkQuota, incrementRequestCount, recordTokenUsage } from '@/lib/billing/usage';
import { buildWorkspaceReplyPrompt } from '@/lib/ai/workspacePrompts';
import { createWorkspaceTools } from '@/lib/ai/workspaceTools';
import admin from 'firebase-admin';

const MODEL = 'gemini-2.5-flash';

export async function POST(req: Request) {
  console.log('==== AI Workspace Reply API Called ====');
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
    console.error('Workspace Reply API Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
