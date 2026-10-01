const DB_NAME = 'taskel-schedule-inbox';
const STORE = 'captures';
const MAX_BYTES = 4 * 1024 * 1024;

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function putCapture(capture) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(capture);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

async function shrinkImage(file) {
    try {
        const bitmap = await createImageBitmap(file);
        const maxEdge = 1600;
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        if (!context) {
            bitmap.close();
            return file;
        }
        context.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
        return new File([blob], 'shared.webp', { type: 'image/webp' });
    } catch {
        return file;
    }
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'POST' || url.pathname !== '/share-target') {
        return;
    }
    event.respondWith(receiveShare(event.request));
});

async function receiveShare(request) {
    try {
        const form = await request.formData();
        const files = form.getAll('image').filter((entry) => entry instanceof File && entry.size > 0);
        if (files.length !== 1) {
            const code = files.length > 1 ? 'multiple' : 'not-image';
            return Response.redirect(`/ja/intake?shareError=${code}`, 303);
        }
        const file = files[0];
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowed.includes(file.type)) {
            return Response.redirect('/ja/intake?shareError=invalid', 303);
        }
        if (file.size > MAX_BYTES) {
            return Response.redirect('/ja/intake?shareError=too-large', 303);
        }
        const stored = await shrinkImage(file);
        if (stored.size > MAX_BYTES) {
            return Response.redirect('/ja/intake?shareError=too-large', 303);
        }
        const id = crypto.randomUUID();
        await putCapture({
            id,
            createdAt: Date.now(),
            kind: 'image',
            shared: true,
            blob: stored,
            name: stored.name || 'shared.webp',
            mime: stored.type || 'image/webp',
            status: 'local',
        });
        return Response.redirect(`/ja/intake?received=${id}`, 303);
    } catch {
        return Response.redirect('/ja/intake?shareError=receive-failed', 303);
    }
}
