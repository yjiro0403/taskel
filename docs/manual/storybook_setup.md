# Storybook 導入・運用マニュアル

## 概要
本プロジェクトでは、UI コンポーネントのカタログ化と独立した開発環境として Storybook を導入しています。
Next.js 16 (App Router) と Tailwind CSS v4 に対応するため、以下の構成を採用しています。

- **Storybook Version**: v10.x (Latest Stable)
- **Framework**: `@storybook/nextjs` (Webpack 5 ベース)
  - *Note: `nextjs-vite` は現状 ESM/CJS の互換性問題があるため、安定した Webpack 版を採用しています。*
- **Addons**:
  - `@storybook/addon-essentials` (Docs, Controls, Actions, Viewport, etc.)
  - `@storybook/addon-a11y` (アクセシビリティ検証)
  - `@storybook/addon-interactions` (インタラクションテスト)

## セットアップ
プロジェクトの依存関係 (`node_modules`) をインストールすれば、Storybook も利用可能になります。

```bash
npm install
```

## コマンド
### 開発サーバー起動
ローカルで Storybook を起動します。デフォルトポートは `6006` です。

```bash
npm run storybook
# アクセス: http://localhost:6006
```

### 静的ビルド
Storybook を静的ファイルとしてビルドします（`storybook-static` ディレクトリに出力）。

```bash
npm run build-storybook
```

## ディレクトリ構成

- `.storybook/`: Storybook の設定ファイル
  - `main.ts`: アドオンやフレームワークの設定
  - `preview.ts`: グローバルスタイル (`globals.css`) の読み込みやパラメータ設定
- `src/stories/`: サンプルストーリー配置場所（必要に応じて削除可）
- `src/**/*.stories.tsx`: コンポーネントごとのストーリーファイル

## ストーリーの追加方法
コンポーネントと同じディレクトリ、または `src/stories` 配下に `[ComponentName].stories.tsx` を作成します。

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta = {
  title: 'Components/Button', // サイドバーでの階層
  component: Button,
  parameters: {
    layout: 'centered', // コンポーネントを画面中央に配置
  },
  tags: ['autodocs'], // 自動ドキュメント生成
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    label: 'Button',
    variant: 'primary',
  },
};
```

## トラブルシューティング
### `ERR_REQUIRE_ESM` エラーが出る場合
Storybook のフレームワーク設定が `nextjs-vite` になっている可能性があります。
`.storybook/main.ts` を確認し、`framework` が `@storybook/nextjs` (Webpack) になっていることを確認してください。

### Tailwind CSS が適用されない
`.storybook/preview.ts` で `src/app/globals.css` がインポートされているか確認してください。

```typescript
import '../src/app/globals.css';
```
