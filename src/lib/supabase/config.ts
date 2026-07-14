/**
 * Read NEXT_PUBLIC_* via static property access only.
 * Next.js inlines these for the client bundle; dynamic process.env[name]
 * is NOT replaced and always looks undefined in the browser.
 */
export function getSupabaseConfig() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url) {
        throw new Error('Missing required Supabase environment variable: NEXT_PUBLIC_SUPABASE_URL');
    }

    if (!anonKey) {
        throw new Error('Missing required Supabase environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }

    return { url, anonKey };
}
