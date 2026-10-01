import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { ALLOWED_IMAGE_MIME, MAX_IMAGE_BYTES } from '@/lib/schedule/constants';
import { stripImageMetadata } from '@/lib/schedule/metadata';
import { createScheduleIntake } from '@/lib/schedule/service';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function localeFromCookie(value: string | undefined): 'ja' | 'en' {
    return value === 'en' ? 'en' : 'ja';
}

function redirectToIntake(request: Request, locale: 'ja' | 'en', query: Record<string, string>) {
    const url = new URL(`/${locale}/intake`, request.url);
    for (const [key, param] of Object.entries(query)) {
        url.searchParams.set(key, param);
    }
    return NextResponse.redirect(url, 303);
}

function bridgePage(mime: string, base64: string, name: string) {
    const payload = JSON.stringify({ mime, base64, name });
    const html = `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Taskel</title>
<body style="font-family:sans-serif;padding:24px">
<p>画像をこの端末に保存しています…</p>
<script>
const payload = ${payload};
const bytes = Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0));
const blob = new Blob([bytes], { type: payload.mime });
const request = indexedDB.open('taskel-schedule-inbox', 1);
request.onupgradeneeded = () => {
  const db = request.result;
  if (!db.objectStoreNames.contains('captures')) {
    db.createObjectStore('captures', { keyPath: 'id' });
  }
};
request.onsuccess = () => {
  const db = request.result;
  const id = crypto.randomUUID();
  const tx = db.transaction('captures', 'readwrite');
  tx.objectStore('captures').put({
    id,
    createdAt: Date.now(),
    kind: 'image',
    shared: true,
    blob,
    name: payload.name || 'shared',
    mime: payload.mime,
    status: 'local',
  });
  tx.oncomplete = () => location.replace('/ja/intake?received=' + id);
  tx.onerror = () => location.replace('/ja/intake?shareError=receive-failed');
};
request.onerror = () => location.replace('/ja/intake?shareError=receive-failed');
</script>
</body>
</html>`;
    return new NextResponse(html, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

export async function POST(request: Request) {
    const jar = await cookies();
    const locale = localeFromCookie(jar.get('NEXT_LOCALE')?.value);
    try {
        const form = await request.formData();
        const files = form.getAll('image').filter((entry): entry is File => entry instanceof File && entry.size > 0);
        if (files.length !== 1) {
            return redirectToIntake(request, locale, { shareError: files.length > 1 ? 'multiple' : 'not-image' });
        }
        const file = files[0];
        if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) {
            return redirectToIntake(request, locale, { shareError: 'invalid' });
        }
        if (file.size > MAX_IMAGE_BYTES) {
            return redirectToIntake(request, locale, { shareError: 'too-large' });
        }
        const supabase = await createClient();
        const { data } = await supabase.auth.getUser();
        if (!data.user) {
            const raw = new Uint8Array(await file.arrayBuffer());
            const bytes = Buffer.from(stripImageMetadata(raw, file.type));
            return bridgePage(file.type, bytes.toString('base64'), 'shared');
        }
        const result = await createScheduleIntake(supabase, data.user, {
            source: 'image_share',
            image: { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type },
            googleAccessToken: null,
        });
        return redirectToIntake(request, locale, { id: result.intake.id });
    } catch {
        return redirectToIntake(request, locale, { shareError: 'receive-failed' });
    }
}
