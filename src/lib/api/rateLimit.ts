import { NextResponse } from 'next/server';

type RateLimitConfig = {
    key: string;
    limit: number;
    windowMs: number;
};

type RateLimitEntry = {
    count: number;
    resetAt: number;
};

type RateLimitStore = Map<string, RateLimitEntry>;

const rateLimitStore = (() => {
    const globalState = globalThis as typeof globalThis & {
        __taskelRateLimitStore?: RateLimitStore;
    };

    if (!globalState.__taskelRateLimitStore) {
        globalState.__taskelRateLimitStore = new Map<string, RateLimitEntry>();
    }

    return globalState.__taskelRateLimitStore;
})();

function getClientIp(request: Request) {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
        return forwardedFor.split(',')[0]?.trim() || 'unknown';
    }

    return request.headers.get('x-real-ip') || 'unknown';
}

function pruneExpiredEntries(now: number) {
    for (const [key, entry] of rateLimitStore.entries()) {
        if (entry.resetAt <= now) {
            rateLimitStore.delete(key);
        }
    }
}

export function applyRateLimit(request: Request, config: RateLimitConfig) {
    const now = Date.now();
    pruneExpiredEntries(now);

    const ip = getClientIp(request);
    const bucketKey = `${config.key}:${ip}`;
    const currentEntry = rateLimitStore.get(bucketKey);

    if (!currentEntry || currentEntry.resetAt <= now) {
        rateLimitStore.set(bucketKey, {
            count: 1,
            resetAt: now + config.windowMs,
        });
        return null;
    }

    if (currentEntry.count >= config.limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((currentEntry.resetAt - now) / 1000));

        return NextResponse.json(
            { error: 'Too many requests' },
            {
                status: 429,
                headers: {
                    'Retry-After': String(retryAfterSeconds),
                    'X-RateLimit-Limit': String(config.limit),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': String(currentEntry.resetAt),
                },
            }
        );
    }

    currentEntry.count += 1;
    rateLimitStore.set(bucketKey, currentEntry);

    return null;
}
