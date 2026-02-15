
import { db, auth, projectId } from './firebaseAdmin';
import { generateSections, generateTasks, generateNotes, generateTags, generateProjects, generateGoals, generateRoutines } from './data/generators';
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

This will PERMANENTLY DELETE all tasks, notes, sections, routines, goals, projects, and tags for this user.
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
        // 3.1 Clear root collections (filtered by userId)
        await deleteQueryBatch(db.collection('tasks').where('userId', '==', targetUserId));
        await deleteQueryBatch(db.collection('goals').where('userId', '==', targetUserId));
        await deleteQueryBatch(db.collection('projects').where('userId', '==', targetUserId));
        await deleteQueryBatch(db.collection('tags').where('userId', '==', targetUserId));

        // 3.2 Clear user subcollections
        const subcollections = ['dailyNotes', 'weeklyNotes', 'monthlyNotes', 'yearlyNotes', 'sections', 'routines'];
        for (const sub of subcollections) {
            await deleteCollectionWithSub(db.collection('users').doc(targetUserId!).collection(sub));
        }
    } else {
        console.log('(Dry Run) Would delete all tasks, goals, projects, tags, and subcollections.');
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
    const tags = generateTags(targetUserId!);
    const projects = generateProjects(targetUserId!);
    const goals = generateGoals(targetUserId!, new Date());
    const routines = generateRoutines(targetUserId!);

    console.log(`- Sections:  ${sections.length}`);
    console.log(`- Tasks:     ${tasks.length}`);
    console.log(`- Notes:     ${notes.length}`);
    console.log(`- Tags:      ${tags.length}`);
    console.log(`- Projects:  ${projects.length}`);
    console.log(`- Goals:     ${goals.length}`);
    console.log(`- Routines:  ${routines.length}`);

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

    // Write Sections (users/{uid}/sections)
    for (const section of sections) {
        const ref = db.collection('users').doc(targetUserId!).collection('sections').doc(section.id);
        batch.set(ref, section);
        await checkBatch();
    }

    // Write Routines (users/{uid}/routines)
    for (const routine of routines) {
        const ref = db.collection('users').doc(targetUserId!).collection('routines').doc(routine.id);
        batch.set(ref, routine);
        await checkBatch();
    }

    // Write Tasks (root tasks collection)
    for (const task of tasks) {
        const ref = db.collection('tasks').doc(task.id);
        // Remove undefined values (Firestore doesn't accept them)
        const cleanTask = JSON.parse(JSON.stringify(task));
        batch.set(ref, cleanTask);
        await checkBatch();
    }

    // Write Tags (root tags collection)
    for (const tag of tags) {
        const ref = db.collection('tags').doc(tag.id);
        batch.set(ref, tag);
        await checkBatch();
    }

    // Write Projects (root projects collection)
    for (const project of projects) {
        const ref = db.collection('projects').doc(project.id);
        batch.set(ref, project);
        await checkBatch();
    }

    // Write Goals (root goals collection)
    for (const goal of goals) {
        const ref = db.collection('goals').doc(goal.id);
        batch.set(ref, goal);
        await checkBatch();
    }

    // Write Notes (users/{uid}/{collection})
    for (const note of notes) {
        const ref = db.collection('users').doc(targetUserId!).collection(note.collection).doc(note.id);
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

    if (snapshot.size >= batchSize) {
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

main().catch(console.error);
