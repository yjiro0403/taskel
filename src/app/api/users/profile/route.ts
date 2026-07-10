import { NextResponse } from 'next/server';
import { getDb } from '@/lib/firebaseAdmin';
import { requireAuth, handleAuthError } from '@/lib/apiAuth';

/**
 * プロジェクトメンバー表示用に、指定 uid の「安全なプロフィール項目のみ」を返す。
 *
 * 背景: 従来は Firestore の users ドキュメントを全認証ユーザーが読める設定で、
 * 課金識別子（stripeCustomerId 等）や email を横断的に取得できてしまっていた。
 * このエンドポイントは「リクエスト元と同じプロジェクトに所属する uid」に限って、
 * displayName / photoURL / email のみを返すことで、列挙・PII 漏洩を防ぐ。
 */
export async function POST(request: Request) {
    try {
        const { uid } = await requireAuth(request);

        const body = await request.json();
        const requested: unknown = body?.uids;
        if (!Array.isArray(requested) || requested.length === 0) {
            return NextResponse.json({ error: 'uids array required' }, { status: 400 });
        }
        const uids = requested
            .filter((u): u is string => typeof u === 'string')
            .slice(0, 200);

        const db = getDb();

        // リクエスト元が所属する全プロジェクトの共同メンバー集合を作る
        const projectsSnap = await db
            .collection('projects')
            .where('memberIds', 'array-contains', uid)
            .get();

        const allowed = new Set<string>([uid]);
        for (const projectDoc of projectsSnap.docs) {
            const memberIds: string[] = projectDoc.data()?.memberIds ?? [];
            for (const m of memberIds) allowed.add(m);
        }

        // 許可された uid のみ、安全な項目だけ返す
        const results: Array<{
            uid: string;
            displayName: string | null;
            email: string | null;
            photoURL: string | null;
        }> = [];

        for (const target of uids) {
            if (!allowed.has(target)) continue;
            const snap = await db.collection('users').doc(target).get();
            const data = snap.exists ? snap.data() : null;
            results.push({
                uid: target,
                displayName: (data?.displayName as string | undefined) ?? null,
                email: (data?.email as string | undefined) ?? null,
                photoURL: (data?.photoURL as string | undefined) ?? null,
            });
        }

        return NextResponse.json({ members: results });
    } catch (error) {
        const authErr = handleAuthError(error);
        if (authErr) return authErr;

        console.error('users/profile error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
