import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAuth } from '@/lib/firebaseAdmin';
import { ApiError } from '@/lib/api/errors';

export async function requireAuth(request: Request): Promise<DecodedIdToken> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new ApiError(401, 'Unauthorized');
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new ApiError(401, 'Unauthorized');
  }

  try {
    return await getAuth().verifyIdToken(token);
  } catch (error) {
    console.error('Auth verification failed:', error);
    throw new ApiError(401, 'Invalid token');
  }
}
