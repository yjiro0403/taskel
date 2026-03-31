import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/firebaseAdmin';
import admin from 'firebase-admin';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { commentCreateSchema } from '@/lib/validations/comment';

/**
 * GET /api/tasks/[taskId]/comments
 * タスクのコメント一覧を取得
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { uid } = await requireAuth(req);

    const { taskId } = await params;
    const db = getDb();

    // タスクの所有権チェック
    const taskDoc = await db.collection('tasks').doc(taskId).get();
    if (!taskDoc.exists || taskDoc.data()?.userId !== uid) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // コメント取得（createdAt昇順）
    const commentsSnapshot = await db
      .collection('tasks')
      .doc(taskId)
      .collection('comments')
      .orderBy('createdAt', 'asc')
      .get();

    const comments = commentsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ comments });
  } catch (error) {
    return handleApiError('GET comments error', error, 'Internal server error');
  }
}

/**
 * POST /api/tasks/[taskId]/comments
 * 新しいコメントを追加
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { uid } = await requireAuth(req);

    const { taskId } = await params;
    const { content, authorName } = await parseJsonBody(req, commentCreateSchema);

    const db = getDb();

    // タスクの所有権チェック
    const taskDoc = await db.collection('tasks').doc(taskId).get();
    if (!taskDoc.exists || taskDoc.data()?.userId !== uid) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const now = Date.now();
    const commentRef = db.collection('tasks').doc(taskId).collection('comments').doc();
    const comment = {
      id: commentRef.id,
      taskId,
      userId: uid,
      authorType: 'user' as const,
      authorName,
      content,
      createdAt: now,
      updatedAt: now,
    };

    // コメント作成 + タスクのcommentCountインクリメント（バッチ）
    const batch = db.batch();
    batch.set(commentRef, comment);
    batch.update(db.collection('tasks').doc(taskId), {
      commentCount: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
    });
    await batch.commit();

    return NextResponse.json({ comment });
  } catch (error) {
    return handleApiError('POST comment error', error, 'Internal server error');
  }
}
