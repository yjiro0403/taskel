import { NextResponse } from 'next/server';
import admin from 'firebase-admin';
import { getDb } from '@/lib/firebaseAdmin';
import { requireAuth, handleAuthError } from '@/lib/apiAuth';

/**
 * タスク作成・更新の BFF。
 *
 * Admin SDK を使うため Firestore ルールをバイパスする。したがって認可はこの
 * ルート内で明示的に行う:
 *  - 本人性は Authorization ヘッダの ID トークンから導出する（ボディの userId は信頼しない）
 *  - 個人タスク: 所有者（userId === 本人）のみ更新可
 *  - プロジェクトタスク: そのプロジェクトの memberIds に含まれる場合のみ作成・更新可
 */

// FirebaseFirestore.Firestore を import せずに使うための型エイリアス
type Db = ReturnType<typeof getDb>;

async function isProjectMember(db: Db, projectId: string, uid: string): Promise<boolean> {
    const snap = await db.collection('projects').doc(projectId).get();
    if (!snap.exists) return false;
    const data = snap.data();
    const memberIds: string[] = data?.memberIds ?? [];
    return data?.ownerId === uid || memberIds.includes(uid);
}

export async function POST(req: Request) {
    try {
        const authed = await requireAuth(req);
        const uid = authed.uid;

        const db = getDb();
        const { task, action } = await req.json();

        if (!task || typeof task.id !== 'string' || !task.id) {
            return NextResponse.json({ error: 'Invalid payload: task.id required' }, { status: 400 });
        }

        const docRef = db.collection('tasks').doc(task.id);

        if (action === 'create') {
            // プロジェクトタスクはメンバーシップ必須
            if (task.projectId) {
                if (!(await isProjectMember(db, task.projectId, uid))) {
                    return NextResponse.json({ error: 'Forbidden: not a project member' }, { status: 403 });
                }
            }

            // 既存ドキュメントを他人が上書きするのを防ぐ（作成時は未存在 or 本人所有のみ許可）
            const existing = await docRef.get();
            if (existing.exists) {
                const data = existing.data();
                const isPersonalOwner = data?.userId === uid;
                const isSharedMember = data?.projectId
                    ? await isProjectMember(db, data.projectId, uid)
                    : false;
                if (!isPersonalOwner && !isSharedMember) {
                    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                }
            }

            // userId は必ずトークン由来の uid に固定（なりすまし防止）
            const taskData = {
                ...task,
                userId: uid,
                createdAt: task.createdAt || Date.now(),
                updatedAt: Date.now(),
            };
            await docRef.set(taskData);
            return NextResponse.json({ success: true, message: 'Task created' });
        }

        if (action === 'update') {
            const existing = await docRef.get();

            if (existing.exists) {
                const data = existing.data();
                const isPersonalOwner = data?.userId === uid;
                const isSharedMember = data?.projectId
                    ? await isProjectMember(db, data.projectId, uid)
                    : false;
                if (!isPersonalOwner && !isSharedMember) {
                    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                }
            } else {
                // 未存在ドキュメントへの update は「本人の新規作成」としてのみ許可する
                if (task.projectId && !(await isProjectMember(db, task.projectId, uid))) {
                    return NextResponse.json({ error: 'Forbidden: not a project member' }, { status: 403 });
                }
            }

            // 認可に関わるフィールド（id / userId / projectId）は更新ペイロードから除外する。
            // userId を書き換えられると所有権が乗っ取られるため必ず落とす。
            const { id: _id, userId: _userId, projectId: _projectId, ...updates } = task;
            void _id;
            void _userId;
            void _projectId;

            const taskData: Record<string, unknown> = {
                ...updates,
                updatedAt: Date.now(),
            };

            // 未存在時の作成に備え、所有者を本人に固定
            if (!existing.exists) {
                taskData.userId = uid;
            }

            // フィールドの正規化:
            //  - null が来たキーは「クリア（削除）」意図として FieldValue.delete() に変換。
            //    set(merge) は null を代入するだけでフィールドを消せず、undefined は
            //    JSON 転送時に脱落するため、週/月ビューの「バックログへ戻す」等の
            //    クリア操作が永続化されず巻き戻っていた（本修正で解消）。
            //  - undefined はスキップ（merge で無害化）。
            const cleanUpdates: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(taskData)) {
                if (value === null) {
                    cleanUpdates[key] = admin.firestore.FieldValue.delete();
                } else if (value !== undefined) {
                    cleanUpdates[key] = value;
                }
            }

            await docRef.set(cleanUpdates, { merge: true });
            return NextResponse.json({ success: true, message: 'Task updated' });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: unknown) {
        const authErr = handleAuthError(error);
        if (authErr) return authErr;

        console.error('API Error in /api/tasks:', error);
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
