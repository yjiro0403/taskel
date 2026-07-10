import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/firebaseAdmin';

/**
 * 認証済みユーザー情報。API ルートでリクエストの本人性を確定するために使う。
 */
export interface AuthedUser {
    uid: string;
    email: string | null;
    name: string | null;
}

/**
 * API ルート内で throw して 401/認可エラーを表現するための専用エラー。
 * `handleAuthError` で NextResponse に変換する。
 */
export class ApiAuthError extends Error {
    status: number;
    constructor(message: string, status = 401) {
        super(message);
        this.name = 'ApiAuthError';
        this.status = status;
    }
}

/**
 * Authorization: Bearer <ID token> を検証し、本人の uid を返す。
 *
 * Admin SDK は Firestore セキュリティルールをバイパスするため、Admin SDK を使う
 * すべての書き込み系 API ルートで必ずこの関数を通し、リクエストボディ由来の
 * userId ではなく、ここで得た uid を信頼の起点にすること。
 */
export async function requireAuth(request: Request): Promise<AuthedUser> {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        throw new ApiAuthError('Unauthorized: missing bearer token', 401);
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
        throw new ApiAuthError('Unauthorized: empty token', 401);
    }

    try {
        const decoded = await getAuth().verifyIdToken(token);
        return {
            uid: decoded.uid,
            email: decoded.email ?? null,
            name: (decoded.name as string | undefined) ?? decoded.email ?? null,
        };
    } catch {
        // 検証失敗の詳細はクライアントに返さない（列挙・情報漏洩防止）
        throw new ApiAuthError('Unauthorized: invalid token', 401);
    }
}

/**
 * ApiAuthError を NextResponse に変換する。それ以外のエラーは呼び出し側で処理する。
 */
export function handleAuthError(error: unknown): NextResponse | null {
    if (error instanceof ApiAuthError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return null;
}
