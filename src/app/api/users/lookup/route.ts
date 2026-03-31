import { NextResponse } from 'next/server';
import { getAuth, getDb } from '@/lib/firebaseAdmin';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { userLookupRequestSchema } from '@/lib/validations/project';

export async function POST(request: Request) {
  try {
    const { uid } = await requireAuth(request);
    const { email, projectId } = await parseJsonBody(request, userLookupRequestSchema);
    const db = getDb();

    const projectSnap = await db.collection('projects').doc(projectId).get();
    if (!projectSnap.exists) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const projectData = projectSnap.data();
    if (!projectData?.memberIds?.includes(uid)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
      const userRecord = await getAuth().getUserByEmail(email);
      if (!projectData.memberIds.includes(userRecord.uid)) {
        return NextResponse.json({ found: false });
      }

      return NextResponse.json({
        found: true,
        user: {
          uid: userRecord.uid,
          email: userRecord.email,
          displayName: userRecord.displayName,
          photoURL: userRecord.photoURL,
        },
      });
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        return NextResponse.json({ found: false });
      }
      throw error;
    }
  } catch (error) {
    return handleApiError('User lookup error', error);
  }
}
