
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Manually load .env.local
const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            let value = valueParts.join('=');
            // Remove quotes if present
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }
            // Handle newlines in private key
            value = value.replace(/\\n/g, '\n');
            process.env[key.trim()] = value.trim();
        }
    });
} else {
    console.error("❌ .env.local file not found!");
    process.exit(1);
}

console.log("Checking Environment Variables...");
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!projectId) console.error("❌ Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID");
else console.log("✅ NEXT_PUBLIC_FIREBASE_PROJECT_ID is set");

if (!clientEmail) console.error("❌ Missing FIREBASE_CLIENT_EMAIL");
else console.log("✅ FIREBASE_CLIENT_EMAIL is set");

if (!privateKey) console.error("❌ Missing FIREBASE_PRIVATE_KEY");
else console.log("✅ FIREBASE_PRIVATE_KEY is set");

if (!projectId || !clientEmail || !privateKey) {
    console.error("Stopping diagnosis due to missing variables.");
    process.exit(1);
}

console.log("\nAttempting Firebase Admin Initialization...");

try {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey,
        }),
    });
    console.log("✅ Firebase Admin initialized successfully!");

    // Test Firestore connection
    const db = admin.firestore();
    db.listCollections().then(collections => {
        console.log(`✅ Connection successful! Found ${collections.length} collections.`);
        process.exit(0);
    }).catch(e => {
        console.error("❌ Firestore connection failed:", e);
        process.exit(1);
    });

} catch (error) {
    console.error("❌ Firebase Admin Initialization Failed:");
    console.error(error);
}
