import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getSupabaseConfig', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    }
    if (originalKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    }
    vi.resetModules();
  });

  it('returns url and anonKey from static env access', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    vi.resetModules();

    const { getSupabaseConfig } = await import('./config');
    expect(getSupabaseConfig()).toEqual({
      url: 'https://example.supabase.co',
      anonKey: 'test-anon-key',
    });
  });

  it('throws when URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    vi.resetModules();

    const { getSupabaseConfig } = await import('./config');
    expect(() => getSupabaseConfig()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
