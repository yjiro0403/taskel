import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

// Initialize Firebase Admin SDK
const serviceAccountPath = path.resolve(process.cwd(), 'SERVICE_ACCOUNT_KEY.json');

if (!fs.existsSync(serviceAccountPath)) {
    console.error(`
❌ ERROR: Service account key not found at: ${serviceAccountPath}

Please follow these steps:
1. Go to Firebase Console > Project Settings > Service Accounts
2. Generate new private key
3. Save the JSON file as "SERVICE_ACCOUNT_KEY.json" in the project root
    `);
    process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

// Prevent accidental execution on PRODUCTION
const PRODUCTION_PROJECT_IDS = ['t-chute-prod', 'taskel-prod']; // Add your prod project IDs here
const projectId = serviceAccount.project_id;

if (PRODUCTION_PROJECT_IDS.includes(projectId)) {
    console.error(`
⛔️ SAFETY LOCK: You are trying to run a script against a PRODUCTION project (${projectId}).
Operation aborted to protect real data.
    `);
    process.exit(1);
}

// Initialize app if not already initialized
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

export const db = admin.firestore();
export const auth = admin.auth();
export { projectId };
