import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function handleApiError(
  context: string,
  error: unknown,
  fallbackMessage = 'Internal Server Error'
) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Invalid request data',
        details: error.flatten(),
      },
      { status: 400 }
    );
  }

  if (error instanceof ApiError) {
    return jsonError(error.message, error.status);
  }

  console.error(`${context}:`, error);
  return jsonError(fallbackMessage, 500);
}
