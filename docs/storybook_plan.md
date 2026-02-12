# Storybook 導入メモ（保留中）

> **ステータス**: 保留（2026-02-10 時点）
> **理由**: Next.js 16 と Storybook エコシステムの互換性問題が未解決

## 調査結果

### 問題の概要

| 項目 | 状態 |
|---|---|
| Next.js | v16.1.1（プロジェクトで使用中） |
| Storybook v8.6.x（安定版） | `next/config` が Next.js 16 で削除されたため起動不可 |
| Storybook v10.2.8（core latest） | Next.js 16 対応済みだがアドオンエコシステムが未整備 |
| アドオン（essentials 等） | v10 が npm に存在しない（最大 v8.6.x / v9-alpha） |

### 試行した構成と結果

1. **v8.6.x 統一** → `Cannot find module 'next/config'` エラー
2. **v10 core + v8 addons** → ESM 互換性エラー（`ERR_REQUIRE_ESM`）
3. **v10 core + v9-alpha addons** → 同上の ESM エラー
4. **v10 core アドオンなし** → ✅ 起動成功（ただし機能制限あり）

## 再導入時のチェックリスト

再導入を検討する際は、以下を確認してください：

- [ ] `npm view @storybook/addon-essentials dist-tags` で v10 以上がリリースされているか
- [ ] `npm view @storybook/addon-interactions dist-tags` で v10 以上がリリースされているか
- [ ] `npm view @storybook/test dist-tags` で v10 以上がリリースされているか
- [ ] 上記すべてが v10 以上であれば、全パッケージを同じバージョンで統一インストール

## 推奨インストール手順（アドオン v10 リリース後）

```bash
# 1. 全パッケージを統一バージョンでインストール
npm install --save-dev \
  storybook@latest \
  @storybook/nextjs@latest \
  @storybook/react@latest \
  @storybook/addon-essentials@latest \
  @storybook/addon-interactions@latest \
  @storybook/addon-onboarding@latest \
  @storybook/addon-a11y@latest \
  @storybook/addon-docs@latest \
  @storybook/test@latest

# 2. Storybook 起動
npm run storybook
```

## 設定ファイル（再導入時に作成）

### `.storybook/main.ts`

```typescript
import type { StorybookConfig } from '@storybook/nextjs';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
    '@storybook/addon-interactions',
    '@storybook/addon-onboarding',
  ],
  framework: {
    name: '@storybook/nextjs',
    options: {},
  },
  staticDirs: ['../public'],
};
export default config;
```

### `.storybook/preview.ts`

```typescript
import type { Preview } from '@storybook/react';
import '../src/app/globals.css';

const preview: Preview = {
  parameters: {
    nextjs: { appDirectory: true },
  },
};
export default preview;
```

## 代替手段（現在利用可能）

- **Playwright** でのスクリーンショット自動撮影は設定済み（`npm run screenshots`）
- 詳細は [screenshot_automation.md](./screenshot_automation.md) を参照
