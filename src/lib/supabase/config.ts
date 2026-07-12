export function getSupabaseConfig() {
    // Next.js only inlines NEXT_PUBLIC_* values into browser bundles when each
    // property is referenced statically. Dynamic access such as
    // process.env[name] remains undefined in production clients.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url) {
        throw new Error('Missing required Supabase environment variable: NEXT_PUBLIC_SUPABASE_URL');
    }

    if (!anonKey) {
        throw new Error('Missing required Supabase environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }

    return {
        url,
        anonKey,
    };
}
