import { NextResponse } from 'next/server';
import { getDb } from '@/lib/firebaseAdmin';
import * as admin from 'firebase-admin';
import { Invitation } from '@/types';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { invitationJoinRequestSchema } from '@/lib/validations/invitation';

export async function POST(request: Request) {
  try {
    const decodedToken = await requireAuth(request);
    const userId = decodedToken.uid;
    const userEmail = decodedToken.email;
    const { inviteToken } = await parseJsonBody(request, invitationJoinRequestSchema);

    const db = getDb();
    const inviteRef = db.collection('invitations').doc(inviteToken);
    const inviteSnap = await inviteRef.get();

    if (!inviteSnap.exists) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    const invitation = inviteSnap.data() as Invitation;

    if (invitation.status === 'accepted' && !invitation.isReusable) {
      return NextResponse.json({ error: 'Invitation already used' }, { status: 400 });
    }

    if (invitation.expiresAt < Date.now()) {
      return NextResponse.json({ error: 'Invitation expired' }, { status: 400 });
    }

    if (invitation.email && invitation.email !== userEmail) {
      return NextResponse.json({ error: 'Invitation is for a different email address.' }, { status: 403 });
    }

    const projectRef = db.collection('projects').doc(invitation.projectId);

    await db.runTransaction(async (transaction) => {
      const projectSnap = await transaction.get(projectRef);
      if (!projectSnap.exists) {
        throw new Error('Project not found');
      }

      transaction.update(projectRef, {
        memberIds: admin.firestore.FieldValue.arrayUnion(userId),
        [`roles.${userId}`]: invitation.role,
        updatedAt: Date.now(),
      });

      if (!invitation.isReusable) {
        transaction.update(inviteRef, {
          status: 'accepted',
        });
      }
    });

    return NextResponse.json({
      success: true,
      projectId: invitation.projectId,
      message: 'Successfully joined project',
    });
  } catch (error) {
    return handleApiError('Error joining project', error);
  }
}
