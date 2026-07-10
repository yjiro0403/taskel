import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { getSafeRedirectPath } from '@/lib/api/url';
import { createClient } from '@/lib/supabase/server';

// 認証コールバック。以下の経路を安全に処理する:
//   1) ?error / ?error_code / ?error_description
//      Supabase 側で失敗（リンク期限切れ・使用済みコード・OAuth拒否 等）。
//      → エラー内容を /login?authError=... に載せて誘導し、原因をユーザーに見せる。
//   2) ?token_hash & ?type
//      サーバ生成リンク（移行スクリプトの admin.generateLink による recovery 等）。
//      ブラウザで PKCE を開始していないため code_verifier クッキーが無く ?code 交換は成立しない。
//      この形式は verifyOtp で検証してセッションを確立する。
//   3) ?code
//      ブラウザで PKCE を開始した通常フロー（signIn/OAuth）。exchangeCodeForSession で交換。
// いずれも成功時のみ next（getSafeRedirectPath 済み）へ遷移し、
// 失敗時は必ず /login?authError=... へ誘導する（保護ページへ着地して無言で弾かれる事故を防ぐ）。
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const next = getSafeRedirectPath(searchParams.get('next'), origin, '/');

    // --- 1) Supabase から error が返っているケースを最優先で処理 ---
    // OAuth拒否やメールリンク失効時、Supabase は ?error=access_denied&error_code=otp_expired 等を付ける。
    const errorCode = searchParams.get('error_code') ?? searchParams.get('error');
    if (errorCode) {
        return redirectToLogin(origin, errorCode, searchParams.get('error_description'));
    }

    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type') as EmailOtpType | null;
    const code = searchParams.get('code');

    const supabase = await createClient();

    // --- 2) token_hash + type: サーバ生成リンク（recovery / email / signup 等） ---
    if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
        if (error) {
            return redirectToLogin(origin, error.code ?? 'otp_verification_failed', error.message);
        }
        return NextResponse.redirect(new URL(next, origin));
    }

    // --- 3) code: 通常の PKCE フロー ---
    if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
            return redirectToLogin(origin, error.code ?? 'code_exchange_failed', error.message);
        }
        return NextResponse.redirect(new URL(next, origin));
    }

    // --- 認証パラメータが一切無い: 不正・直アクセスとして /login へ ---
    return redirectToLogin(origin, 'missing_auth_params');
}

// /login?authError=<code>[&authErrorDescription=<...>] へリダイレクトするヘルパー。
// リダイレクト先は固定の /login 相対パスに限定し、オープンリダイレクト（getSafeRedirectPath の
// 保証）を壊さない。description は原因把握の補助情報として任意で付与する。
function redirectToLogin(origin: string, code: string, description?: string | null) {
    const url = new URL('/login', origin);
    url.searchParams.set('authError', code);
    if (description) {
        url.searchParams.set('authErrorDescription', description);
    }
    return NextResponse.redirect(url);
}
