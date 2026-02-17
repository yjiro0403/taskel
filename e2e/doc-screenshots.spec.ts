import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Screenshot output directory (taskel-docs/public/images/)
const SCREENSHOT_DIR = path.resolve(__dirname, '../../taskel-docs/public/images');

// Ensure directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const screenshot = (name: string) => path.join(SCREENSHOT_DIR, name);

// Login credentials
const EMAIL = 'taskeltest@taskel.com';
const PASSWORD = 'taskel';

// Helper: login via the login form (Firebase Auth uses indexedDB, so storageState doesn't work)
async function login(page: Page) {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('#email').fill(EMAIL);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/tasks', { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Let Firebase Auth + data load settle
}

test.use({ viewport: { width: 1280, height: 800 } });

// Increase timeout for login + page load + AI responses
test.setTimeout(90000);

// Run tests serially to avoid login race conditions
test.describe.configure({ mode: 'serial' });

test.describe('Documentation Screenshots', () => {

    // --- Public pages (no auth needed) ---

    test('1. Landing Page', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: screenshot('landing-page.png'), fullPage: false });
    });

    test('2. Login Page', async ({ page }) => {
        await page.goto('/login');
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: screenshot('login-page.png'), fullPage: false });
    });

    // --- Authenticated pages ---

    test('3. Daily View (Task List)', async ({ page }) => {
        await login(page);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: screenshot('daily-view.png'), fullPage: false });
    });

    test('4. Task In Progress (Play → Stop)', async ({ page }) => {
        await login(page);
        await page.waitForTimeout(1000);

        // Find an open task and click its play button
        const playButton = page.locator('button:has(svg.lucide-play)').first();
        if (await playButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            await playButton.click();
            await page.waitForTimeout(1500);
        }
        await page.screenshot({ path: screenshot('task-in-progress.png'), fullPage: false });
    });

    test('5. Task Edit Modal', async ({ page }) => {
        await login(page);
        await page.waitForTimeout(1000);

        // Click on a task title text to open edit modal
        const taskTitle = page.locator('[class*="task"] span, [class*="task"] p, .truncate').first();
        if (await taskTitle.isVisible({ timeout: 3000 }).catch(() => false)) {
            await taskTitle.click();
            await page.waitForTimeout(1000);
        }
        await page.screenshot({ path: screenshot('task-edit-modal.png'), fullPage: false });
    });

    test('6. Task Multi-Select', async ({ page }) => {
        await login(page);
        await page.waitForTimeout(1000);

        // Click selection circles on multiple tasks
        const selectionCircles = page.locator('[data-testid="task-select"], .task-select-circle, [class*="selection"]');
        const count = await selectionCircles.count();
        for (let i = 0; i < Math.min(3, count); i++) {
            await selectionCircles.nth(i).click();
            await page.waitForTimeout(200);
        }
        await page.waitForTimeout(500);
        await page.screenshot({ path: screenshot('task-selection.png'), fullPage: false });
    });

    test('7. AI Chat Panel', async ({ page }) => {
        await login(page);
        await page.waitForTimeout(1000);

        // Open AI panel via sparkles button
        const aiButton = page.locator('button:has(svg.lucide-sparkles)').first();
        if (await aiButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            await aiButton.click();
            await page.waitForTimeout(1500);
        }
        await page.screenshot({ path: screenshot('ai-chat-panel.png'), fullPage: false });
    });

    test('8. AI Task Suggestion', async ({ page }) => {
        await login(page);
        await page.waitForTimeout(1000);

        // Open AI panel
        const aiButton = page.locator('button:has(svg.lucide-sparkles)').first();
        if (await aiButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            await aiButton.click();
            await page.waitForTimeout(1500);
        }

        // Type a task suggestion request
        const chatInput = page.locator('textarea').first();
        if (await chatInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await chatInput.fill('明日のMTG資料を準備するタスクを追加して');
            await chatInput.press('Enter');
            // Wait for AI response
            await page.waitForTimeout(10000);
        }
        await page.screenshot({ path: screenshot('ai-task-suggestion.png'), fullPage: false });
    });

    test('9. AI Daily Review', async ({ page }) => {
        await login(page);
        await page.waitForTimeout(1000);

        // Open AI panel
        const aiButton = page.locator('button:has(svg.lucide-sparkles)').first();
        if (await aiButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            await aiButton.click();
            await page.waitForTimeout(1500);
        }

        // Request daily review
        const chatInput = page.locator('textarea').first();
        if (await chatInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await chatInput.fill('今日の振り返りをして');
            await chatInput.press('Enter');
            await page.waitForTimeout(12000);
        }
        await page.screenshot({ path: screenshot('ai-daily-review.png'), fullPage: false });
    });

    test('10. AI Calibration', async ({ page }) => {
        await login(page);
        await page.waitForTimeout(1000);

        // Open AI panel
        const aiButton = page.locator('button:has(svg.lucide-sparkles)').first();
        if (await aiButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            await aiButton.click();
            await page.waitForTimeout(1500);
        }

        // Request calibration
        const chatInput = page.locator('textarea').first();
        if (await chatInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await chatInput.fill('見積もりの精度を分析して');
            await chatInput.press('Enter');
            await page.waitForTimeout(12000);
        }
        await page.screenshot({ path: screenshot('ai-calibration.png'), fullPage: false });
    });

    test('11. Weekly View', async ({ page }) => {
        await login(page);
        await page.goto('/weekly');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: screenshot('weekly-view.png'), fullPage: false });
    });

    test('12. Monthly View', async ({ page }) => {
        await login(page);
        await page.goto('/monthly');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: screenshot('monthly-view.png'), fullPage: false });
    });

    test('13. Yearly View', async ({ page }) => {
        await login(page);
        await page.goto('/yearly');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: screenshot('yearly-view.png'), fullPage: false });
    });

    test('14. Planning View', async ({ page }) => {
        await login(page);
        await page.goto('/planning');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: screenshot('planning-view.png'), fullPage: false });
    });

    test('15. Calendar View', async ({ page }) => {
        await login(page);
        await page.goto('/calendar');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: screenshot('calendar-view.png'), fullPage: false });
    });

    test('16. Analytics', async ({ page }) => {
        await login(page);
        await page.goto('/analytics');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(4000); // Wait for charts to render
        await page.screenshot({ path: screenshot('analytics-trends.png'), fullPage: false });
    });

    test('17. Projects List', async ({ page }) => {
        await login(page);
        await page.goto('/projects');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: screenshot('projects-list.png'), fullPage: false });
    });

    test('18. Project Detail', async ({ page }) => {
        await login(page);
        await page.goto('/projects');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);

        // Click on the first project to open detail
        const projectItem = page.locator('a[href*="/projects/"]').first();
        if (await projectItem.isVisible({ timeout: 3000 }).catch(() => false)) {
            await projectItem.click();
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(2000);
        }
        await page.screenshot({ path: screenshot('project-detail.png'), fullPage: false });
    });

    test('19. Routines', async ({ page }) => {
        await login(page);
        await page.goto('/routines');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: screenshot('routines-list.png'), fullPage: false });
    });

    test('20. Settings - Schedule', async ({ page }) => {
        await login(page);
        await page.goto('/settings/schedule');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: screenshot('settings-schedule.png'), fullPage: false });
    });
});
