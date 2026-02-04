
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/firebaseAdmin'; // Ensure this points to your Admin SDK setup
import { Task } from '@/types'; // Ensure you have Task type available

export async function POST(req: Request) {
    try {
        const db = getDb();
        const { task, action } = await req.json();
        const userId = task.userId; // Ensure userId is passed or derived from auth token if needed

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized: No userId provided' }, { status: 401 });
        }

        // Determine collection path based on project or user-private
        let collectionRef;
        let docRef;

        if (task.projectId) {
            collectionRef = db.collection('tasks');
            docRef = collectionRef.doc(task.id);
        } else {
            // UNIFIED: Use 'tasks' for everything now
            collectionRef = db.collection('tasks');
            docRef = collectionRef.doc(task.id);
        }

        if (action === 'create') {
            // Sanitize data (simple version, rely on client for now or add stricter schema validation later)
            const taskData = {
                ...task,
                createdAt: task.createdAt || Date.now(),
                updatedAt: Date.now()
            };
            await docRef.set(taskData);
            return NextResponse.json({ success: true, message: 'Task created' });

        } else if (action === 'update') {
            // Remove metadata fields that shouldn't be part of the update payload
            const { id, userId, projectId, ...updates } = task;

            const taskData = {
                ...updates,
                updatedAt: Date.now()
            };

            // Remove undefined fields
            const cleanUpdates = JSON.parse(JSON.stringify(taskData));

            // Use set with merge: true instead of update() 
            // because update() fails if the document doesn't exist.
            await docRef.set(cleanUpdates, { merge: true });
            return NextResponse.json({ success: true, message: 'Task updated' });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
