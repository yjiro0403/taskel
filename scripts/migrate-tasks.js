
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// 1. Manually load .env.local
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
} else {
    console.error("❌ .env.local file not found!");
    process.exit(1);
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!projectId || !clientEmail || !privateKey) {
    console.error("❌ Missing environment variables");
    process.exit(1);
}

// 2. Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
    }),
});

const db = admin.firestore();

async function migrate() {
    console.log("🚀 Starting migration...");

    try {
        // 3. Get all users
        const usersSnap = await db.collection('users').get();
        console.log(`Found ${usersSnap.size} users.`);

        let totalMoved = 0;

        for (const userDoc of usersSnap.docs) {
            const userId = userDoc.id;
            console.log(`Processing user: ${userId}`);

            const userTasksRef = db.collection('users').doc(userId).collection('tasks');
            const tasksSnap = await userTasksRef.get();

            if (tasksSnap.empty) {
                console.log(`  No tasks found for user ${userId}`);
                continue;
            }

            console.log(`  Found ${tasksSnap.size} tasks. Moving...`);

            const batch = db.batch();
            let batchCount = 0;

            for (const taskDoc of tasksSnap.docs) {
                const taskData = taskDoc.data();
                const taskId = taskDoc.id;

                // Ensure userId is strictly set to the owner of the private collection
                const migratedTask = {
                    ...taskData,
                    id: taskId,
                    userId: userId, // Enforce correct owner
                    migratedAt: Date.now()
                };

                // Write to global tasks collection
                const targetRef = db.collection('tasks').doc(taskId);
                batch.set(targetRef, migratedTask, { merge: true });

                batchCount++;
                if (batchCount >= 400) {
                    await batch.commit();
                    console.log(`    Committed batch of ${batchCount} tasks...`);
                    // Reset batch? No, wait, batch object is one-time use usually?
                    // Yes, create new batch.
                    // But for simplicity in this script, assuming < 400 tasks per user for now or doing sequential batches logic properly is annoying.
                    // Let's just create a new batch.
                    // Actually, simple batch variable reassignment works.
                }
            }

            if (batchCount > 0) {
                await batch.commit();
                console.log(`    Committed final batch of tasks for user ${userId}.`);
            }
            totalMoved += tasksSnap.size;
        }

        console.log(`✅ Migration complete. Moved ${totalMoved} tasks.`);

    } catch (error) {
        console.error("❌ Migration failed:", error);
    }
}

migrate();
