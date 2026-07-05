import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';

import { routing } from './i18n/routing';
import { updateSession } from './lib/supabase/middleware';

const handleI18nRouting = createMiddleware(routing);

export default async function middleware(request: NextRequest) {
    // /auth/* は [locale] の外にあるルート（OAuth/メール確認のコールバック等）。
    // next-intl の localePrefix='always' により /ja/auth/... へ 307 リダイレクトされ
    // 404 になるのを防ぐため、i18n ルーティングを回さず Supabase セッション更新のみ行う。
    if (request.nextUrl.pathname.startsWith('/auth')) {
        return updateSession(request);
    }

    const response = handleI18nRouting(request);

    return updateSession(request, response);
}

export const config = {
    // Match all paths except special files and APIs
    matcher: ['/((?!api|_next|.*\\..*).*)']
};
