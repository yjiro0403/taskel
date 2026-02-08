
import { NextResponse } from 'next/server';
import { getAuth, getDb } from '@/lib/firebaseAdmin';
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
        try {
            const decodedToken = await getAuth().verifyIdToken(token);
            userId = decodedToken.uid;
        } catch (authError) {
            console.error('Auth verification failed:', authError);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { projectId, email, role } = await request.json();

        if (!projectId) {
            return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
        }

        const db = getDb();

        // Verify Project Ownership/Role
        // Only owner or admin can invite?
        const projectRef = db.collection('projects').doc(projectId);
        const projectSnap = await projectRef.get();
        if (!projectSnap.exists) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        const projectData = projectSnap.data();
        if (!projectData) {
            return NextResponse.json({ error: 'Project data missing' }, { status: 500 });
        }

        const userRole = projectData.roles?.[userId];
        const isOwner = projectData.ownerId === userId;

        if (!isOwner && userRole !== 'owner' && userRole !== 'admin') {
            return NextResponse.json({ error: 'Insufficient permissions to invite' }, { status: 403 });
        }

        // Create Invitation
        const inviteId = crypto.randomUUID();
        const now = Date.now();
        const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days expiration for link

        const isReusable = !email; // If no email, reusable link

        const invitation: Invitation = {
            id: inviteId,
            projectId,
            role: role || 'member',
            inviterId: userId,
            status: 'pending',
            createdAt: now,
            expiresAt,
            isReusable
        };

        if (email) {
            invitation.email = email;
        }

        await db.collection('invitations').doc(inviteId).set(invitation);

        // Generate Join Link
        // Use origin from request if available, otherwise fallback
        const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://taskel.vercel.app';
        const joinLink = `${origin}/join?token=${inviteId}`;

        return NextResponse.json({ success: true, joinLink });
    } catch (error) {
        console.error('Error generating invitation:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
