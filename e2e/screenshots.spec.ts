import { test } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// スクリーンショット保存先のディレクトリ
const SCREENSHOT_DIR = 'screenshots';

// ディレクトリが存在しない場合は作成
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR);
}

test.describe('Screenshots', () => {
    test('Landing Page (Root)', async ({ page }) => {
        // トップページに移動
        await page.goto('/');

        // ページのロード待機（必要に応じて）
        await page.waitForLoadState('networkidle');

        // スクリーンショット撮影
        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, 'landing-page.png'),
            fullPage: true
        });
    });

    // Loginページがあれば（例）
    test('Login Page', async ({ page }) => {
        // ログインページへの遷移が可能であればコメントアウトを外して調整
        /*
        await page.goto('/login');
        await page.waitForLoadState('networkidle');
        await page.screenshot({ 
          path: path.join(SCREENSHOT_DIR, 'login-page.png'), 
          fullPage: true 
        });
        */
    });
});
