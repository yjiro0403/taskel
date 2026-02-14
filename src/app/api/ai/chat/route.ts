import { streamText } from 'ai';
import { google } from '@ai-sdk/google';
import { format } from 'date-fns';
import { buildSystemPrompt } from '@/lib/ai/prompts';
import { createAITools } from '@/lib/ai/tools';

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
    const json = await req.json();
    const {
      messages,
      userId,
      currentDate,
      sections,
      model: requestedModel,
      // Phase 2追加: クライアントからのGoals/Calibrationヒント
      activeGoals,
      calibrationHint,
    } = json;

    if (!userId) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 要求されたモデルが許可されていない場合はデフォルトを使用
    const modelName = ALLOWED_MODELS.includes(requestedModel) ? requestedModel : 'gemini-2.5-flash';
    console.log(`Using model: ${modelName}`);

    const today = currentDate || format(new Date(), 'yyyy-MM-dd');

    const result = streamText({
      model: google(modelName),
      system: buildSystemPrompt({
        currentDate: today,
        activeGoals,       // Phase 2追加
        calibrationHint,   // Phase 2追加
      }),
      messages: normalizeMessages(messages),
      tools: createAITools({ userId, currentDate: today, sections: sections || [] }),
      toolChoice: 'auto',
      // Phase 2: Goal Breakdown時の複数ツール呼び出しに対応
      // AI SDK v6.0.82はデフォルトで十分なステップ数を確保しているため、
      // 明示的なmaxSteps設定は不要（自動で複数ツール呼び出しに対応）
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
