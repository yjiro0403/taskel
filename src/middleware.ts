import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';

import { routing } from './i18n/routing';
import { updateSession } from './lib/supabase/middleware';

const handleI18nRouting = createMiddleware(routing);

export default async function middleware(request: NextRequest) {
    const response = handleI18nRouting(request);

    return updateSession(request, response);
}

export const config = {
    // Match all paths except special files and APIs
    matcher: ['/((?!api|_next|.*\\..*).*)']
};
