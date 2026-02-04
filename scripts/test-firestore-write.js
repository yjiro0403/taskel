
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Manually verify credentials again
const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            let value = valueParts.join('=');
            if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            value = value.replace(/\\n/g, '\n');
            process.env[key.trim()] = value.trim();
        }
    });
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!privateKey || !clientEmail) {
    console.error("Missing credentials");
    process.exit(1);
}

// Initialize Admin SDK
try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId,
                clientEmail,
                privateKey,
            }),
        });
    }
} catch (e) {
    console.error("Init Error:", e);
    process.exit(1);
}

const db = admin.firestore();

async function testWrite() {
    console.log("Attempting to write to Firestore...");
    try {
        const testDocRef = db.collection('debug_tests').doc('api_test');
        await testDocRef.set({
            timestamp: Date.now(),
            message: "Hello from local test script"
        });
        console.log("✅ Successfully wrote to Firestore!");

        // Clean up
        await testDocRef.delete();
        console.log("✅ Successfully deleted test document.");

    } catch (error) {
        console.error("❌ Write Failed:", error);
    }
}

testWrite();
