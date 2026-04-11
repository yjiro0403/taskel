import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { createClient } from '@/lib/supabase/server';
import { mapTaskComment } from '@/lib/supabase/mappers';
import { commentCreateSchema } from '@/lib/validations/comment';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    await requireAuth();
    const { taskId } = await params;
    const supabase = await createClient();

    const { data: canAccessTask, error: accessError } = await supabase.rpc('can_access_task', {
      task_uuid: taskId,
    });

    if (accessError) {
      throw accessError;
    }

    if (!canAccessTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id')
      .eq('id', taskId)
      .maybeSingle();

    if (taskError) {
      throw taskError;
    }

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const { data: comments, error: commentError } = await supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });

    if (commentError) {
      throw commentError;
    }

    return NextResponse.json({ comments: comments.map(mapTaskComment) });
  } catch (error) {
    return handleApiError('GET comments error', error, 'Internal server error');
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await requireAuth();
    const { taskId } = await params;
    const { content, authorName } = await parseJsonBody(req, commentCreateSchema);
    const supabase = await createClient();

    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id, comment_count')
      .eq('id', taskId)
      .maybeSingle();

    if (taskError) {
      throw taskError;
    }

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const { data: insertedComment, error: insertError } = await supabase
      .from('task_comments')
      .insert({
        task_id: taskId,
        user_id: user.id,
        author_type: 'user',
        author_name: authorName ?? null,
        content,
      })
      .select('*')
      .single();

    if (insertError) {
      throw insertError;
    }

    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        comment_count: (task.comment_count ?? 0) + 1,
      })
      .eq('id', taskId);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({ comment: mapTaskComment(insertedComment) });
  } catch (error) {
    return handleApiError('POST comment error', error, 'Internal server error');
  }
}
