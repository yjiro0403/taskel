import { NextResponse } from 'next/server';
import { getDb } from '@/lib/firebaseAdmin';
import { Invitation } from '@/types';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { getAppUrl } from '@/lib/api/url';
import { invitationCreateRequestSchema } from '@/lib/validations/invitation';

export async function POST(request: Request) {
  try {
    const { uid } = await requireAuth(request);
    const { projectId, email, role } = await parseJsonBody(request, invitationCreateRequestSchema);
    const db = getDb();

    const projectRef = db.collection('projects').doc(projectId);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const projectData = projectSnap.data();
    if (!projectData) {
      return NextResponse.json({ error: 'Project data missing' }, { status: 500 });
    }

    const userRole = projectData.roles?.[uid];
    const isOwner = projectData.ownerId === uid;

    if (!isOwner && userRole !== 'owner' && userRole !== 'admin') {
      return NextResponse.json({ error: 'Insufficient permissions to invite' }, { status: 403 });
    }

    const inviteId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
    const isReusable = !email;

    const invitation: Invitation = {
      id: inviteId,
      projectId,
      role: role || 'member',
      inviterId: uid,
      status: 'pending',
      createdAt: now,
      expiresAt,
      isReusable,
    };

    if (email) {
      invitation.email = email;
    }

    await db.collection('invitations').doc(inviteId).set(invitation);

    const joinLink = `${getAppUrl()}/join?token=${inviteId}`;
    return NextResponse.json({ success: true, joinLink });
  } catch (error) {
    return handleApiError('Error generating invitation', error);
  }
}
