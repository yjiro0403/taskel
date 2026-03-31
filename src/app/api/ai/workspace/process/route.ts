import { generateText, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import { format } from 'date-fns';
import { checkQuota, incrementRequestCount, recordTokenUsage } from '@/lib/billing/usage';
import { buildWorkspaceProcessPrompt } from '@/lib/ai/workspacePrompts';
import { createWorkspaceTools } from '@/lib/ai/workspaceTools';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError, jsonError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { createClient } from '@/lib/supabase/server';
import { taskIdRequestSchema } from '@/lib/validations/task';

const MODEL = 'gemini-2.5-flash';

export async function POST(req: Request) {
  console.log('==== AI Workspace Process API Called ====');
  try {
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

    // 4. ステータスを processing に更新
    await supabase.from('tasks').update({ ai_status: 'processing' }).eq('id', taskId);

    const today = format(new Date(), 'yyyy-MM-dd');

    // 5. AI処理実行
    try {
      const systemPrompt = buildWorkspaceProcessPrompt({
        currentDate: today,
        taskTitle: taskData.title,
        taskMemo: taskData.memo ?? undefined,
        taskTags: [],
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
        await supabase.from('task_comments').insert({
          task_id: taskId,
          user_id: uid,
          author_type: 'ai',
          author_name: 'Taskel AI',
          content: result.text,
        });
        await supabase.from('tasks').update({
          comment_count: (taskData.comment_count ?? 0) + 1,
        });
      }

      // 8. ステータスを completed に更新
      await supabase.from('tasks').update({
        ai_status: 'completed',
        ai_completed_at: new Date().toISOString(),
      });

      return new Response(
        JSON.stringify({ status: 'completed', taskId }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (aiError) {
      console.error('AI processing error:', aiError);

      // エラー時のステータス更新
      const errorMessage = 'AI processing failed';
      await supabase.from('tasks').update({
        ai_status: 'error',
        ai_error: errorMessage,
      });

      return new Response(
        JSON.stringify({ status: 'error', error: errorMessage }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    return handleApiError('Workspace Process API Error', error);
  }
}
