import { NextResponse } from 'next/server';
import { getDb } from '@/lib/firebaseAdmin';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError, jsonError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { taskMutationRequestSchema } from '@/lib/validations/task';

export async function POST(req: Request) {
  try {
    const { uid } = await requireAuth(req);
    const { task, action } = await parseJsonBody(req, taskMutationRequestSchema);
    const db = getDb();
    const docRef = db.collection('tasks').doc(task.id);

    if (action === 'create') {
      const existingTask = await docRef.get();
      if (existingTask.exists && existingTask.data()?.userId !== uid) {
        return jsonError('Forbidden', 403);
      }

      const taskData = {
        ...task,
        userId: uid,
        createdAt: task.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      await docRef.set(taskData);
      return NextResponse.json({ success: true, message: 'Task created' });
    }

    const existingTask = await docRef.get();
    if (!existingTask.exists) {
      return jsonError('Task not found', 404);
    }

    if (existingTask.data()?.userId !== uid) {
      return jsonError('Forbidden', 403);
    }

    const { id, ...updates } = task;
    const taskData = {
      ...updates,
      updatedAt: Date.now(),
    };

    const cleanUpdates = JSON.parse(JSON.stringify(taskData));
    await docRef.set(cleanUpdates, { merge: true });
    return NextResponse.json({ success: true, message: 'Task updated' });
  } catch (error) {
    return handleApiError('API Error in /api/tasks', error);
  }
}
