import { NextRequest, NextResponse } from 'next/server';
import { getAuth, getDb } from '@/lib/firebaseAdmin';
import admin from 'firebase-admin';

/**
 * GET /api/tasks/[taskId]/comments
 * タスクのコメント一覧を取得
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    let uid: string;
    try {
      const decoded = await getAuth().verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

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
    console.error('GET comments error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    let uid: string;
    try {
      const decoded = await getAuth().verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { taskId } = await params;
    const { content, authorType, authorName } = await req.json();

    if (!content || !authorType) {
      return NextResponse.json({ error: 'content and authorType are required' }, { status: 400 });
    }

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
      authorType,
      authorName: authorName || (authorType === 'ai' ? 'Taskel AI' : undefined),
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
    console.error('POST comment error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
