import { streamText } from 'ai';
import { google } from '@ai-sdk/google';
import { format } from 'date-fns';
import { buildSystemPrompt } from '@/lib/ai/prompts';
import { createAITools } from '@/lib/ai/tools';
import { getAuth } from '@/lib/firebaseAdmin';
import { checkQuota, incrementRequestCount, recordTokenUsage } from '@/lib/billing/usage';

// メッセージの正規化ヘルパー
function normalizeMessages(messages: any[]) {
  return messages.map((m: any) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: (m.content || (m.parts ? m.parts.map((p: any) => p.text || '').join('') : '') || ' ') as string,
  }));
}

// 使用可能なモデルのホワイトリスト
const ALLOWED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-3-flash',
  'gemini-2.5-pro',
  'gemini-3-pro',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];

export async function POST(req: Request) {
  console.log('==== AI Chat API Called ====');
  try {
    // 1. Bearer トークン認証
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
        {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 3. リクエストカウントを事前インクリメント（並行リクエスト対策）
    await incrementRequestCount(uid);

    const json = await req.json();
    const {
      messages,
      currentDate,
      sections,
      model: requestedModel,
      activeGoals,
      calibrationHint,
    } = json;

    // 要求されたモデルが許可されていない場合はデフォルトを使用
    const modelName = ALLOWED_MODELS.includes(requestedModel) ? requestedModel : 'gemini-2.5-flash';
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
    console.error('AI Chat API Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
