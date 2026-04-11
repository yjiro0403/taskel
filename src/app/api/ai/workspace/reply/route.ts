import { generateText, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import { format } from 'date-fns';
import { checkQuota, incrementRequestCount, recordTokenUsage } from '@/lib/billing/usage';
import { buildWorkspaceReplyPrompt } from '@/lib/ai/workspacePrompts';
import { createWorkspaceTools } from '@/lib/ai/workspaceTools';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError, jsonError } from '@/lib/api/errors';
import { applyRateLimit } from '@/lib/api/rateLimit';
import { parseJsonBody } from '@/lib/api/request';
import { createClient } from '@/lib/supabase/server';
import { taskIdRequestSchema } from '@/lib/validations/task';

const MODEL = 'gemini-2.5-flash';

export async function POST(req: Request) {
  console.log('==== AI Workspace Reply API Called ====');
  try {
    const rateLimitResponse = applyRateLimit(req, {
      key: '/api/ai/workspace/reply',
      limit: 15,
      windowMs: 60_000,
    });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const user = await requireAuth();
    const uid = user.id;

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

    const supabase = await createClient();

    // 3. タスク取得 + 所有権チェック
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .maybeSingle();
    if (taskError) {
      throw taskError;
    }
    if (!taskData) {
      return jsonError('Task not found', 404);
    }

    // 4. コメント履歴を取得（最新20件）
    const { data: comments, error: commentsError } = await supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (commentsError) {
      throw commentsError;
    }

    const commentThread = [...comments].reverse().map((data) => {
      return {
        authorType: data.author_type as 'user' | 'ai',
        authorName: data.author_name ?? undefined,
        content: data.content,
        createdAt: new Date(data.created_at).getTime(),
      };
    });

    const today = format(new Date(), 'yyyy-MM-dd');

    // 5. AI応答生成
    const systemPrompt = buildWorkspaceReplyPrompt({
      currentDate: today,
      taskTitle: taskData.title,
      taskMemo: taskData.memo ?? undefined,
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
      const { data: comment, error: commentError } = await supabase
        .from('task_comments')
        .insert({
          task_id: taskId,
          user_id: uid,
          author_type: 'ai',
          author_name: 'Taskel AI',
          content: result.text,
        })
        .select('*')
        .single();
      if (commentError) {
        throw commentError;
      }
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
