/**
 * Automated login script - logs in via Playwright, extracts UID, saves auth state.
 */
import { chromium } from '@playwright/test';
import * as path from 'path';

const AUTH_FILE = path.resolve(__dirname, 'auth.json');
const EMAIL = 'taskeltest@taskel.com';
const PASSWORD = 'taskel';

async function autoLogin() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    console.log('Navigating to login page...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');

    console.log('Filling in credentials...');
    await page.locator('#email').fill(EMAIL);
    await page.locator('#password').fill(PASSWORD);

    console.log('Submitting login form...');
    await page.locator('button[type="submit"]').click();

    // Wait for redirect to /tasks (successful login)
    console.log('Waiting for login redirect...');
    await page.waitForURL('**/tasks', { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Let Firebase Auth settle

    console.log('Login successful! Extracting UID...');

    // Try multiple methods to extract Firebase UID
    const uid = await page.evaluate(async () => {
        // Method 1: localStorage
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('firebase:authUser:')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key) || '');
                    if (data.uid) return data.uid;
                } catch {}
            }
        }

        // Method 2: Check all localStorage keys for uid pattern
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const val = localStorage.getItem(key!) || '';
            if (val.includes('"uid"')) {
                try {
                    const data = JSON.parse(val);
                    if (data.uid) return data.uid;
                } catch {}
            }
        }

        // Method 3: indexedDB (Firebase Auth uses this by default in newer SDKs)
        try {
            const dbs = await indexedDB.databases();
            for (const dbInfo of dbs) {
                if (dbInfo.name && dbInfo.name.includes('firebase')) {
                    const db = await new Promise<IDBDatabase>((resolve, reject) => {
                        const req = indexedDB.open(dbInfo.name!);
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => reject(req.error);
                    });
                    const storeNames = Array.from(db.objectStoreNames);
                    for (const storeName of storeNames) {
                        try {
                            const tx = db.transaction(storeName, 'readonly');
                            const store = tx.objectStore(storeName);
                            const allKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
                                const req = store.getAllKeys();
                                req.onsuccess = () => resolve(req.result);
                                req.onerror = () => reject(req.error);
                            });
                            const allValues = await new Promise<any[]>((resolve, reject) => {
                                const req = store.getAll();
                                req.onsuccess = () => resolve(req.result);
                                req.onerror = () => reject(req.error);
                            });
                            for (const val of allValues) {
                                if (val && typeof val === 'object' && val.uid) {
                                    return val.uid;
                                }
                                if (val && typeof val === 'object' && val.value && val.value.uid) {
                                    return val.value.uid;
                                }
                            }
                        } catch {}
                    }
                    db.close();
                }
            }
        } catch {}

        return null;
    });

    // Method 4: Try to get from the page's window object (Zustand store, etc.)
    const uid2 = uid || await page.evaluate(() => {
        // Check if there's a global auth state
        try {
            // @ts-ignore - access Zustand store from window
            const store = (window as any).__NEXT_DATA__;
            if (store?.props?.pageProps?.user?.uid) return store.props.pageProps.user.uid;
        } catch {}
        return null;
    });

    const finalUid = uid || uid2;

    if (finalUid) {
        console.log(`FIREBASE_UID=${finalUid}`);
    } else {
        // Dump localStorage keys for debugging
        const keys = await page.evaluate(() => {
            const result: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                result.push(localStorage.key(i)!);
            }
            return result;
        });
        console.log('localStorage keys:', JSON.stringify(keys));

        const idbNames = await page.evaluate(async () => {
            try {
                const dbs = await indexedDB.databases();
                return dbs.map(d => d.name);
            } catch { return []; }
        });
        console.log('indexedDB databases:', JSON.stringify(idbNames));

        console.log('WARNING: Could not extract Firebase UID. Check debug info above.');
    }

    // Save storage state for Playwright reuse
    await context.storageState({ path: AUTH_FILE });
    console.log(`Auth state saved to: ${AUTH_FILE}`);

    await browser.close();
    return finalUid;
}

autoLogin().catch(err => {
    console.error('Login failed:', err.message);
    process.exit(1);
});
