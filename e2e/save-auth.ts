/**
 * Save Playwright auth state from a logged-in browser session.
 *
 * Usage:
 *   1. Run `npx playwright open http://localhost:3000` and log in manually
 *   2. Run `npx ts-node e2e/save-auth.ts` in another terminal
 *      OR use the Playwright codegen approach below
 *
 * Alternative (recommended):
 *   npx playwright codegen http://localhost:3000 --save-storage=e2e/auth.json
 *   → Log in manually in the browser, then close it. Auth state is saved.
 */

import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_FILE = path.resolve(__dirname, 'auth.json');

async function saveAuth() {
    console.log('Launching browser for auth state capture...');
    console.log('Please log in to Taskel, then press Enter in this terminal.\n');

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('http://localhost:3000/login');

    // Wait for user to log in
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>(resolve => {
        rl.question('Press Enter after logging in...', () => {
            rl.close();
            resolve();
        });
    });

    // Extract Firebase UID from localStorage/indexedDB
    const uid = await page.evaluate(() => {
        // Try localStorage first (Firebase Auth persistence)
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('firebase:authUser:')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key) || '');
                    return data.uid || null;
                } catch { return null; }
            }
        }
        return null;
    });

    if (uid) {
        console.log(`\nFirebase UID: ${uid}`);
        console.log(`Use this for seeding: npm run seed:demo -- --userId=${uid}`);
    } else {
        console.log('\nCould not extract Firebase UID from localStorage.');
        console.log('Firebase may be using indexedDB persistence. Check the browser DevTools.');
    }

    // Save storage state
    await context.storageState({ path: AUTH_FILE });
    console.log(`\nAuth state saved to: ${AUTH_FILE}`);

    await browser.close();
}

saveAuth().catch(console.error);
