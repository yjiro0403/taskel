# CLAUDE.md - Taskel Development Guide

## Commands
- **Run Dev Server**: `npm run dev` (Starts at http://localhost:3000)
- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Storybook**: `npm run storybook` (Starts at http://localhost:6006)
- **Build Storybook**: `npm run build-storybook`
- **Seed Demo Data**: `npm run seed:demo`
- **Screenshots**: `npm run screenshots` (Playwright E2E)
- **Deploy**: `vercel deploy` (Production) / `vercel deploy --prebuilt` (Preview)

## Project Structure
- **Framework**: Next.js (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Backend/DB**: Firebase (Firestore, Auth, Storage)
- **State Management**: Zustand
- **Deployment**: Vercel

## Directory Overview
- `src/app`: App Router pages and layouts. API routes in `src/app/api`.
- `src/components`: Reusable UI components. `AIChatPanel.tsx` handles AI chat interface.
  - `src/components/ai`: AI-specific components (TaskCreationCard, ChatMessage, ChatInput, ModelSelector).
- `src/lib`: Utilities and Firebase configuration (`firebase.ts`).
  - `src/lib/ai`: AI-specific modules (types, prompts, tools, dateResolver).
- `src/store`: Global state management (Zustand stores, e.g., `useStore.ts`).
- `src/hooks`: Custom React hooks.
- `src/types`: TypeScript type definitions.
- `src/content`: Static content or markdown resources.
- `src/contexts`: React Context providers.
- `public`: Static assets.

## Coding Standards
- **Components**: Functional components with strict typing. Use `React.FC` or typed props interface.
- **Styling**: Use Tailwind utility classes. Avoid inline styles or CSS modules unless necessary.
- **State**: Use local state for UI only; use Zustand for global/shared state.
- **Async**: Use `async/await`. Handle errors with try/catch blocks.
- **Imports**: Use absolute imports (`@/components/...`, `@/lib/...`) as configured in `tsconfig.json`.

## Taskel Specifics
- **Philosophy**: "Time Management OS" for Executors. Focus on flow, time calibration, and specific "Single Active Task" focus.
- **Core Value**: Acts as a "Smart Task Partner" to mitigate time blindness and implementation friction.
- **AI Integration**:
  - Frontend: `src/components/AIChatPanel.tsx`
    - Sub-components: `ChatMessage.tsx`, `ChatInput.tsx`, `ModelSelector.tsx`, `TaskCreationCard.tsx`
  - Backend: `src/app/api/ai/chat/route.ts` (using Vercel AI SDK & Gemini)
  - AI Modules: `src/lib/ai/` (types, prompts, tools, dateResolver)
- **Data Flow (User Agency Pattern)**:
  1. User Input → AI Analysis (Server: route.ts)
  2. Tool Result: TaskCandidate JSON (DB書き込みなし)
  3. Client: TaskCreationCard表示でプレビュー
  4. User: 内容確認・編集
  5. User: 「作成」ボタン押下
  6. Client: Zustand confirmTaskCandidate() → addTask() → BFF API /api/tasks → Firestore
- **AI Tools**:
  - `suggestTask`: タスク候補を提案（Firestore書き込みなし、TaskCandidateを返す）
  - `getTodayTasks`: 今日のタスク一覧をFirestoreから取得して要約を返す

## Agent Team Setup: taskel-core-dev-team
- **Lead** (Artifact: `task.md`): 調整専任。delegate mode。タスク分解・割り当て・結果統合のみを行い、自分ではコードを書かない。
- **Architect** (Artifact: `implementation_plan.md`): CLAUDE.md と仕様書を読み、データモデル・API・画面フロー等の設計を担当。
- **Dev**: Architect の設計に従ってコードを実装・リファクタする。
- **QA** (Artifact: `walkthrough.md`): コードと仕様を確認し、テストケースとバグ報告を作成し、必要に応じて修正案を提案する。
- **運用ルール**:
  - すべての大きな変更は /plan で計画を確認してから実行する。
  - Goal / Task の CRUD 変更は必ず QA にテストケース作成を依頼する。
