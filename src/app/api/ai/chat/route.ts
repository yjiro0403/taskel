import { streamText } from 'ai';
import { google } from '@ai-sdk/google';
import { format } from 'date-fns';
import { buildSystemPrompt } from '@/lib/ai/prompts';
import { createAITools } from '@/lib/ai/tools';
import { checkQuota, incrementRequestCount, recordTokenUsage } from '@/lib/billing/usage';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { aiChatRequestSchema } from '@/lib/validations/ai';

// メッセージの正規化ヘルパー
function normalizeMessages(messages: any[]) {
  return messages.map((m: any) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: (m.content || (m.parts ? m.parts.map((p: any) => p.text || '').join('') : '') || ' ') as string,
  }));
}

export async function POST(req: Request) {
  console.log('==== AI Chat API Called ====');
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
        {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 3. リクエストカウントを事前インクリメント（並行リクエスト対策）
    await incrementRequestCount(uid);

    const json = await parseJsonBody(req, aiChatRequestSchema);
    const {
      messages,
      currentDate,
      sections,
      model: requestedModel,
      activeGoals,
      calibrationHint,
    } = json;

    const modelName = requestedModel ?? 'gemini-2.5-flash';
    console.log(`Using model: ${modelName}`);

    const today = currentDate || format(new Date(), 'yyyy-MM-dd');

    const result = streamText({
      model: google(modelName),
      system: buildSystemPrompt({
        currentDate: today,
        activeGoals,
        calibrationHint,
      }),
      messages: normalizeMessages(messages),
      tools: createAITools({ userId: uid, currentDate: today, sections: sections || [] }),
      toolChoice: 'auto',
    });

    // 4. ストリーム完了後にトークン使用量を記録（fire-and-forget）
    Promise.resolve(result.totalUsage).then((usage) => {
      if (usage.inputTokens || usage.outputTokens) {
        recordTokenUsage(uid, usage.inputTokens || 0, usage.outputTokens || 0);
      }
    }).catch((err) => {
      console.error('Failed to get total usage:', err);
    });

    // ai SDK v6: useChat互換のUIMessageStreamResponseを使用
    return result.toUIMessageStreamResponse();
  } catch (error: unknown) {
    return handleApiError('AI Chat API Error', error);
  }
}
