import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dirname =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

/**
 * ロジックのユニットテスト専用設定（node 環境・Storybook 非依存）。
 *
 * 既定の vitest.config.ts は Storybook のブラウザテスト構成で、外部ブラウザ実行を
 * 要するため CI/ローカルの軽量ロジック検証には不向き。ルーチン頻度判定など、実データに
 * 影響する純粋ロジックの回帰を防ぐために本設定を分離している。
 *
 *   npm run test:unit
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.unit.test.ts'],
  },
});
