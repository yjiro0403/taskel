import { ZodType } from 'zod';
import { ApiError } from '@/lib/api/errors';

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>
): Promise<T> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON body');
  }

  return schema.parse(body);
}
