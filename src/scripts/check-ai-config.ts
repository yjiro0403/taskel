
import fs from 'fs';
import path from 'path';

// Manual .env parser
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    console.log('Loading .env.local from:', envPath);
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
        // Skip comments and empty lines
        if (!line || line.startsWith('#')) return;

        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            let value = match[2].trim();
            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
                // Handle newlines in double quotes
                if (line.includes('"')) {
                    value = value.replace(/\\n/g, '\n');
                }
            }
            process.env[key] = value;
        }
    });
} else {
    console.warn('.env.local NOT FOUND at:', envPath);
}

import { getDb } from '../lib/firebaseAdmin';
import { google } from '@ai-sdk/google';
import { streamText } from 'ai';

async function check() {
    console.log('==== Configuration Check ====');

    // 1. Firebase Check
    console.log('[Firebase] Initializing...');

    // Simulate Next.js env (remove GOOGLE_APPLICATION_CREDENTIALS if exists)
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.log('[Test Info] Removing GOOGLE_APPLICATION_CREDENTIALS to test Private Key path...');
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }

    try {
        const db = getDb();
        console.log('[Firebase] getDb() success.');

        // Try to verify connection (optional, just init for now)
        // const snapshot = await db.collection('test').limit(1).get();
        // console.log('[Firebase] Connection Verified.');
    } catch (e) {
        console.error('[Firebase] Initialization FAILED:', e);
    }

    // 2. Google AI Check
    console.log('[Google AI] Checking API Key...');
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (apiKey) {
        console.log('[Google AI] API Key is SET (Length: ' + apiKey.length + ')');
    } else {
        console.error('[Google AI] API Key is MISSING!');
    }

    console.log('[Google AI] Initializing Model...');
    // Note: We don't initialize a single model here anymore.

    // 3. Stream Text Check (Try multiple models)
    const modelsToTry = [
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-flash-latest'
    ];

    console.log('[Google AI] Testing streamText with multiple models...');

    for (const modelName of modelsToTry) {
        console.log(`\n--- Testing Model: ${modelName} ---`);
        try {
            const result = await streamText({
                model: google(modelName),
                messages: [{ role: 'user', content: 'Say "OK" only.' }],
            });

            let fullText = '';
            for await (const part of result.textStream) {
                process.stdout.write(part);
                fullText += part;
            }
            console.log(`\n[SUCCESS] Model ${modelName} works! Response: ${fullText}`);
        } catch (e: any) {
            console.error(`[FAILED] Model ${modelName}:`, e.message);
        }
    }

    console.log('\n==== Checking Available Models via REST API ====');
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
        const response = await fetch(listUrl);
        const data = await response.json();
        if (data.models) {
            console.log(`[SUCCESS] Found ${data.models.length} models:`);
            data.models.forEach((m: any) => {
                if (m.supportedGenerationMethods?.includes('generateContent')) {
                    console.log(` - ${m.name} (${m.displayName})`);
                }
            });
        } else {
            console.error('[FAILED] ListModels response:', JSON.stringify(data, null, 2));
        }
    } catch (e) {
        console.error('[FAILED] ListModels fetch error:', e);
    }

    console.log('\n==== End Check ====');
}

check();
