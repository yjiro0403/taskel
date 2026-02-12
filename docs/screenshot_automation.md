# スクリーンショット自動化ガイド (Screenshot Automation Guide)

Playwrightを使用して、マニュアル作成用などのスクリーンショットを自動生成する手順です。
将来的なStorybook導入によるコンポーネント単位の撮影も見据えていますが、まずは実際のページ遷移に基づいた撮影を行います。

## 概要

- **ツール**: Playwright
- **目的**: マニュアル用画像の自動生成、UIリグレッションテストの基礎
- **出力先**: `screenshots/` ディレクトリ (git管理外)

## セットアップ

初回のみ以下のコマンドを実行してください。

```bash
npm install
npx playwright install
```

## スクリーンショットの撮影

以下のコマンドを実行すると、`e2e/screenshots.spec.ts` に定義されたシナリオに沿ってブラウザが起動し、スクリーンショットが撮影されます。

```bash
npm run screenshots
```

撮影された画像は `screenshots/` フォルダに保存されます。

## シナリオの追加・修正

`e2e/screenshots.spec.ts` を編集してください。

```typescript
test('タスク一覧画面', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({ path: 'screenshots/task_list.png', fullPage: true });
});
```

## 今後の展望: Storybookとの連携

### Storybookのセットアップ (完了)

Storybookは導入済みです。以下のコマンドで起動できます。

```bash
npm run storybook
```

### コンポーネントの追加

`src/components` 以下のコンポーネントに対して、`src/stories` またはコンポーネントと同じディレクトリに `*.stories.tsx` ファイルを作成してください。

例: `Button.stories.tsx`

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    children: 'Button',
    variant: 'primary',
  },
};
```

### スクリーンショット自動化 (Future Work)

現在、PlaywrightによるE2Eスクリーンショット撮影を行っていますが、Storybookの各ストーリーを画像化することも可能です。
これには `storybook-addon-image-snapshots` や Chromatic などのツールを追加導入する必要があります。
現状は E2E (ページ単位) の撮影を優先しています。
