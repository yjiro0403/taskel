
import { NextResponse } from 'next/server';
import { getAuth, getDb } from '@/lib/firebaseAdmin';

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            // Optional: allow public check if needed? No, better secure.
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Verify token
        const token = authHeader.split('Bearer ')[1];
        try {
            await getAuth().verifyIdToken(token);
        } catch {
            return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
        }

        const { email } = await request.json();

        if (!email) {
            return NextResponse.json({ error: 'Email required' }, { status: 400 });
        }

        try {
            const userRecord = await getAuth().getUserByEmail(email);

            // Return public info
            return NextResponse.json({
                found: true,
                user: {
                    uid: userRecord.uid,
                    email: userRecord.email,
                    displayName: userRecord.displayName,
                    photoURL: userRecord.photoURL,
                }
            });
        } catch (error: any) {
            if (error.code === 'auth/user-not-found') {
                return NextResponse.json({ found: false });
            }
            throw error;
        }

    } catch (error) {
        console.error('User lookup error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
