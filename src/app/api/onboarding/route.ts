import { NextResponse } from 'next/server';
import { getDb } from '@/lib/firebaseAdmin';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { userId } = body;

        if (!userId) {
            return NextResponse.json({ error: 'User ID required' }, { status: 400 });
        }

        const db = getDb();
        const batch = db.batch();
        const sectionsRef = db.collection('users').doc(userId).collection('sections');
        const tasksRef = db.collection('users').doc(userId).collection('tasks');

        // Check if sections already exist (double check)
        const sectionsSnap = await sectionsRef.limit(1).get();
        if (!sectionsSnap.empty) {
            return NextResponse.json({ message: 'Onboarding already completed' });
        }

        // 1. Create Default Sections
        const sectionsData = [
            { name: 'Morning (Start ~ 9:00)', startTime: '06:00', order: 0 },
            { name: 'Work (9:00 ~ 12:00)', startTime: '09:00', order: 1 },
            { name: 'Afternoon (13:00 ~ 18:00)', startTime: '13:00', order: 2 },
            { name: 'Evening (18:00 ~ End)', startTime: '18:00', order: 3 },
        ];

        let firstSectionId = '';

        for (const [index, section] of sectionsData.entries()) {
            const docRef = sectionsRef.doc();
            if (index === 0) firstSectionId = docRef.id;

            batch.set(docRef, {
                id: docRef.id,
                userId,
                name: section.name,
                startTime: section.startTime,
                order: section.order
            });
        }

        // 2. Create Onboarding Tasks
        const todayStr = new Date().toISOString().split('T')[0];
        const onboardingTasks = [
            {
                title: '▶️ このタスクの再生ボタンを押して開始する',
                estimatedMinutes: 5,
                order: 0
            },
            {
                title: '✅ 終わったらチェックボタンで完了する',
                estimatedMinutes: 1,
                order: 1
            },
            {
                title: '📝 タスクをクリックして詳細を編集する',
                estimatedMinutes: 3,
                order: 2
            },
            {
                title: '➕ 右下のボタンから新しいタスクを追加',
                estimatedMinutes: 0,
                order: 3
            }
        ];

        for (const t of onboardingTasks) {
            const taskRef = tasksRef.doc();
            batch.set(taskRef, {
                id: taskRef.id,
                userId,
                title: t.title,
                sectionId: firstSectionId,
                date: todayStr,
                status: 'open',
                estimatedMinutes: t.estimatedMinutes,
                actualMinutes: 0,
                order: t.order,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }

        await batch.commit();

        return NextResponse.json({ success: true, message: 'Onboarding data created' });
    } catch (error) {
        console.error('Onboarding error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
