
import { db, auth, projectId } from './firebaseAdmin';
import { generateSections, generateTasks, generateNotes } from './data/generators';
import * as readline from 'readline';

// --- CLI Arguments & Parsing ---
const args = process.argv.slice(2);
const help = args.includes('--help');
const dryRun = args.includes('--dry-run');
const clearOnly = args.includes('--clear-only');
const scaleMap: Record<string, 'normal' | 'large'> = { normal: 'normal', large: 'large' };

// Parse --userId=xxx
const userIdArg = args.find(a => a.startsWith('--userId='));
const targetUserId = userIdArg ? userIdArg.split('=')[1] : null;

// Parse --scale=xxx
const scaleArg = args.find(a => a.startsWith('--scale='));
const scaleVal = scaleArg ? scaleArg.split('=')[1] : 'normal'; // default normal
const targetScale = scaleMap[scaleVal] || 'normal';

if (help || !targetUserId) {
    console.log(`
Usage: npm run seed:demo -- --userId=<UID> [options]

Options:
  --userId=<UID>       (Required) Target User ID to seed data into.
  --scale=<scale>      'normal' (default) or 'large' (rich data for video)
  --dry-run            Simulate execution without writing to DB.
  --clear-only         Delete existing data only, do not generate new data.
  --help               Show this help message.
    `);
    process.exit(0);
}

// --- Main Logic ---
async function main() {
    console.log('='.repeat(50));
    console.log('🌱 Taskel Demo Data Seeder');
    console.log('='.repeat(50));

    // 1. Fetch User Info (Verify existence)
    let userEmail = 'Unknown';
    try {
        const userRecord = await auth.getUser(targetUserId!);
        userEmail = userRecord.email || 'No Email';
    } catch (e) {
        console.error(`❌ User not found: ${targetUserId}`);
        process.exit(1);
    }

    // 2. Confirmation Prompt
    console.log(`
🎯 Target Environment: ${projectId}
👤 Target User:       ${userEmail} (UID: ${targetUserId})
📊 Scale:             ${targetScale}
🛠  Mode:              ${dryRun ? 'DRY RUN (No changes)' : 'LIVE EXECUTION'}
⚠️  Action:            ${clearOnly ? 'DELETE DATA ONLY' : 'DELETE & SEED DATA'}

This will PERMANENTLY DELETE all tasks, notes, sections, and routines for this user.
    `);

    if (!dryRun) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const answer = await new Promise<string>(resolve => {
            rl.question('Type "yes" to continue: ', resolve);
        });
        rl.close();

        if (answer.trim() !== 'yes') {
            console.log('Aborted.');
            process.exit(0);
        }
    } else {
        console.log('>> DRY RUN: Skipping confirmation.');
    }

    // 3. Clear Existing Data
    console.log('\n🧹 Clearing existing data...');
    if (!dryRun) {
        await clearCollection(`users/${targetUserId}/tasks`); // Old path if any?
        // Unified path in recent architecture:
        // Actually, tasks are now in root 'tasks' collection, filtered by userId.
        // And notes are in 'users/{uid}/{collection}'

        // 3.1 Clear root tasks
        await deleteQueryBatch(db.collection('tasks').where('userId', '==', targetUserId));

        // 3.2 Clear user subcollections
        const subcollections = ['dailyNotes', 'weeklyNotes', 'monthlyNotes', 'yearlyNotes', 'sections', 'routines', 'tags'];
        for (const sub of subcollections) {
            await deleteCollectionWithSub(db.collection('users').doc(targetUserId!).collection(sub));
        }
    } else {
        console.log('(Dry Run) Would delete all tasks and subcollections.');
    }

    if (clearOnly) {
        console.log('✅ Clear only completed.');
        process.exit(0);
    }

    // 4. Generate Data
    console.log('\n🎲 Generating demo data...');
    const sections = generateSections(targetUserId!);
    const tasks = generateTasks(targetUserId!, new Date(), targetScale);
    const notes = generateNotes(targetUserId!, new Date());

    console.log(`- Sections: ${sections.length}`);
    console.log(`- Tasks:    ${tasks.length}`);
    console.log(`- Notes:    ${notes.length}`);

    if (dryRun) {
        console.log('(Dry Run) Skipping write.');
        process.exit(0);
    }

    // 5. Write Data
    console.log('\n💾 Writing to Firestore...');
    const batchSize = 400; // Limit is 500
    let batch = db.batch();
    let counter = 0;

    // Helper to commit if full
    const checkBatch = async () => {
        counter++;
        if (counter >= batchSize) {
            await batch.commit();
            batch = db.batch();
            counter = 0;
            process.stdout.write('.');
        }
    };

    // Write Sections
    // Note: In store/useStore.ts `addSection`, it writes to `users/{uid}/sections`.
    for (const section of sections) {
        const ref = db.collection('users').doc(targetUserId!).collection('sections').doc(section.id);
        batch.set(ref, section);
        await checkBatch();
    }

    // Write Tasks
    // Store: `tasks` root collection
    for (const task of tasks) {
        const ref = db.collection('tasks').doc(task.id);
        batch.set(ref, task);
        await checkBatch();
    }

    // Write Notes
    // Generator returns object with `collection` prop
    for (const note of notes) {
        const ref = db.collection('users').doc(targetUserId!).collection(note.collection).doc(note.id);
        // Remove 'collection' prop before saving
        const { collection: _, ...data } = note;
        batch.set(ref, data);
        await checkBatch();
    }

    // Final commit
    if (counter > 0) {
        await batch.commit();
    }

    console.log('\n\n✅ Seeding completed! You can now login as the demo user.');
}

// --- Helpers ---

async function deleteQueryBatch(query: FirebaseFirestore.Query) {
    const snapshot = await query.get();
    const batchSize = 400;
    if (snapshot.size === 0) return;

    let batch = db.batch();
    let counter = 0;

    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
        counter++;
    });
    await batch.commit();

    // Recurse if there might be more (offset/limit not used here but good practice for massive datasets)
    // For specific user data, one batch usually enough, but let's be safe.
    if (snapshot.size >= batchSize) {
        // Recursive delete (simple version)
        await deleteQueryBatch(query);
    }
}

async function deleteCollectionWithSub(collectionRef: FirebaseFirestore.CollectionReference) {
    const snapshot = await collectionRef.get();
    if (snapshot.size === 0) return;

    let batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
}

// Deprecated in new model but kept for safety if run on old data structures
async function clearCollection(path: string) {
    const ref = db.collection(path);
    await deleteCollectionWithSub(ref);
}

main().catch(console.error);
