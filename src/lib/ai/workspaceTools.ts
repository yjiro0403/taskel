/**
 * Taskel AI Workspace用ツール
 * チャットAI（提案のみ）と異なり、DB直接書き込みが可能
 */

import { z } from 'zod';
import { tool } from 'ai';
import { getDb } from '@/lib/firebaseAdmin';
import admin from 'firebase-admin';

interface WorkspaceToolContext {
  userId: string;
  taskId: string;
  currentDate: string;
}

export function createWorkspaceTools(ctx: WorkspaceToolContext) {
  // @ts-ignore - AI SDK tool type definitions are complex
  return {
    /**
     * 独立した通常タスクを新規作成
     */
    createTask: tool({
      description: 'Create a new independent task. Use this when the user asks to break down work into tasks or create related tasks.',
      parameters: z.object({
        title: z.string().describe('Task title'),
        date: z.string().optional().describe('Task date in YYYY-MM-DD format. Defaults to today.'),
        estimatedMinutes: z.number().optional().describe('Estimated time in minutes. Default 30.'),
        memo: z.string().optional().describe('Task memo/description'),
        tags: z.array(z.string()).optional().describe('Tags for the task'),
      }),
      // @ts-ignore
      execute: async (args: any) => {
        const { title, date, estimatedMinutes, memo, tags } = args;
        const db = getDb();

        const taskId = crypto.randomUUID();
        const now = Date.now();

        // ユーザーのセクションを取得して最初のセクションを使用
        const sectionsSnapshot = await db
          .collection('sections')
          .where('userId', '==', ctx.userId)
          .orderBy('order', 'asc')
          .limit(1)
          .get();

        const defaultSectionId = sectionsSnapshot.docs[0]?.id || 'section-1';

        const newTask = {
          id: taskId,
          userId: ctx.userId,
          title,
          sectionId: defaultSectionId,
          date: date || ctx.currentDate,
          status: 'open',
          estimatedMinutes: estimatedMinutes || 30,
          actualMinutes: 0,
          order: 999, // 末尾に追加
          tags: tags || [],
          memo: memo || '',
          createdAt: now,
          updatedAt: now,
        };

        await db.collection('tasks').doc(taskId).set(newTask);

        return {
          type: 'task_created',
          taskId,
          title,
          date: newTask.date,
          estimatedMinutes: newTask.estimatedMinutes,
          message: `タスク「${title}」を作成しました`,
        };
      },
    }),

    /**
     * タスクのコンバセーションにコメントを投稿
     */
    postComment: tool({
      description: 'Post a comment to the task conversation. Use this to share analysis results, summaries, or any text output.',
      parameters: z.object({
        content: z.string().describe('Comment content in Markdown format'),
      }),
      // @ts-ignore
      execute: async (args: any) => {
        const { content } = args;
        const db = getDb();
        const now = Date.now();

        const commentRef = db
          .collection('tasks')
          .doc(ctx.taskId)
          .collection('comments')
          .doc();

        const comment = {
          id: commentRef.id,
          taskId: ctx.taskId,
          userId: ctx.userId,
          authorType: 'ai',
          authorName: 'Taskel AI',
          content,
          createdAt: now,
          updatedAt: now,
        };

        const batch = db.batch();
        batch.set(commentRef, comment);
        batch.update(db.collection('tasks').doc(ctx.taskId), {
          commentCount: admin.firestore.FieldValue.increment(1),
          updatedAt: now,
        });
        await batch.commit();

        return {
          type: 'comment_posted',
          commentId: commentRef.id,
          message: 'コメントを投稿しました',
        };
      },
    }),

    /**
     * URLの内容を取得して分析
     */
    analyzeUrl: tool({
      description: 'Fetch and analyze the content of a URL. Use this when the task memo contains URLs that need to be analyzed.',
      parameters: z.object({
        url: z.string().url().describe('The URL to fetch and analyze'),
        instruction: z.string().optional().describe('Specific instruction for analysis (e.g., "summarize", "extract key points")'),
      }),
      // @ts-ignore
      execute: async (args: any) => {
        const { url, instruction } = args;
        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Taskel-AI/1.0',
              'Accept': 'text/html,application/json,text/plain',
            },
            signal: AbortSignal.timeout(15000), // 15秒タイムアウト
          });

          if (!response.ok) {
            return {
              type: 'url_analysis',
              url,
              success: false,
              error: `HTTP ${response.status}: ${response.statusText}`,
              message: `URLの取得に失敗しました: ${response.status}`,
            };
          }

          const contentType = response.headers.get('content-type') || '';
          let content: string;

          if (contentType.includes('application/json')) {
            const json = await response.json();
            content = JSON.stringify(json, null, 2).slice(0, 10000);
          } else {
            const text = await response.text();
            // HTMLタグを簡易的に除去してテキストを抽出
            content = text
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 10000); // 最大10000文字
          }

          return {
            type: 'url_analysis',
            url,
            success: true,
            contentLength: content.length,
            content,
            instruction: instruction || 'general analysis',
            message: `URLの内容を取得しました (${content.length}文字)`,
          };
        } catch (error) {
          return {
            type: 'url_analysis',
            url,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            message: 'URLの取得中にエラーが発生しました',
          };
        }
      },
    }),
  };
}
