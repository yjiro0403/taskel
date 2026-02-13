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
- `src/lib`: Utilities and Firebase configuration (`firebase.ts`).
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
  - Backend: `src/app/api/ai/chat/route.ts` (using Vercel AI SDK)
- **Data Flow**: User Input -> AI Suggestion (Client) -> User Confirmation -> Firestore Write.
