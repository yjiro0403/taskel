import { NextResponse } from 'next/server';

/**
 * 軽量なインメモリ・レートリミッタ。
 *
 * 注意: サーバーレス（Vercel）ではインスタンスごとにメモリが分離されるため、
 * これはあくまでベストエフォートの緩和策（メール乱発・AI 課金枯渇・列挙攻撃の
 * 増幅を抑える）である。厳密な制限が必要になった場合は Upstash 等の共有ストアへ
 * 置き換えること。
 */
interface Bucket {
    count: number;
    resetAt: number;
}

const buckets = new Map<string, Bucket>();

// メモリ肥大を防ぐための簡易掃除（期限切れバケットを間引く）
function sweep(now: number) {
    if (buckets.size < 5000) return;
    for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
    }
}

export interface RateLimitResult {
    ok: boolean;
    remaining: number;
    resetAt: number;
}

/**
 * key（例: `invite:<uid>`）ごとに windowMs あたり limit 回まで許可する。
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    sweep(now);

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
    }

    if (bucket.count >= limit) {
        return { ok: false, remaining: 0, resetAt: bucket.resetAt };
    }

    bucket.count += 1;
    return { ok: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

/**
 * 制限超過時に返す 429 レスポンスを生成する。
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
    const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
    );
}
