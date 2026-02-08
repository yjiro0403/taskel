
import { NextResponse } from 'next/server';
import { getAuth, getDb } from '@/lib/firebaseAdmin';
import * as admin from 'firebase-admin';
import { Invitation } from '@/types';

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const token = authHeader.split('Bearer ')[1];

        // Verify User
        let userId;
        let userEmail;
        try {
            const decodedToken = await getAuth().verifyIdToken(token);
            userId = decodedToken.uid;
            userEmail = decodedToken.email;
        } catch (authError) {
            console.error('Auth verification failed:', authError);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { inviteToken } = await request.json();

        if (!inviteToken) {
            return NextResponse.json({ error: 'Missing invite token' }, { status: 400 });
        }

        const db = getDb();
        const inviteRef = db.collection('invitations').doc(inviteToken);
        const inviteSnap = await inviteRef.get();

        if (!inviteSnap.exists) {
            return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
        }

        const invitation = inviteSnap.data() as Invitation;

        // Check Status & Expiration
        if (invitation.status === 'accepted' && !invitation.isReusable) {
            return NextResponse.json({ error: 'Invitation already used' }, { status: 400 });
        }

        if (invitation.expiresAt < Date.now()) {
            return NextResponse.json({ error: 'Invitation expired' }, { status: 400 });
        }

        // Check Email Restriction (if set)
        if (invitation.email && invitation.email !== userEmail) {
            // Be careful with privacy? Maybe generic error.
            return NextResponse.json({ error: 'Invitation is for a different email address.' }, { status: 403 });
        }

        const projectRef = db.collection('projects').doc(invitation.projectId);

        // Run as Transaction
        await db.runTransaction(async (transaction) => {
            const pSnap = await transaction.get(projectRef);
            if (!pSnap.exists) {
                throw new Error('Project not found');
            }

            // Add member
            transaction.update(projectRef, {
                memberIds: admin.firestore.FieldValue.arrayUnion(userId),
                [`roles.${userId}`]: invitation.role,
                updatedAt: Date.now()
            });

            // Update Invitation status if NOT reusable
            if (!invitation.isReusable) {
                transaction.update(inviteRef, {
                    status: 'accepted'
                });
            }
        });

        return NextResponse.json({
            success: true,
            projectId: invitation.projectId,
            message: 'Successfully joined project'
        });

    } catch (error) {
        console.error('Error joining project:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
    }
}
