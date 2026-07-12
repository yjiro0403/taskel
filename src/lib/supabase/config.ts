function requireEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required Supabase environment variable: ${name}`);
    }

    return value;
}

export function getSupabaseConfig() {
    return {
        url: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
        anonKey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    };
}
