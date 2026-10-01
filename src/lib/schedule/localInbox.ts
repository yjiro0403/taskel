import { LOCAL_INBOX_DB, LOCAL_INBOX_STORE } from '@/lib/schedule/constants';

export interface LocalCapture {
    id: string;
    createdAt: number;
    kind: 'image' | 'text';
    shared: boolean;
    blob?: Blob;
    text?: string;
    name: string;
    mime: string;
    status: 'local' | 'uploaded' | 'error';
    remoteId?: string;
    error?: string;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(LOCAL_INBOX_DB, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(LOCAL_INBOX_STORE)) {
                db.createObjectStore(LOCAL_INBOX_STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(LOCAL_INBOX_STORE, mode);
            const request = run(tx.objectStore(LOCAL_INBOX_STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

export async function saveLocalCapture(capture: LocalCapture): Promise<void> {
    if (typeof indexedDB === 'undefined') {
        return;
    }
    await withStore('readwrite', (store) => store.put(capture));
}

export async function listLocalCaptures(): Promise<LocalCapture[]> {
    if (typeof indexedDB === 'undefined') {
        return [];
    }
    const rows = await withStore<LocalCapture[]>('readonly', (store) => store.getAll());
    return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function removeLocalCapture(id: string): Promise<void> {
    if (typeof indexedDB === 'undefined') {
        return;
    }
    await withStore('readwrite', (store) => store.delete(id));
}
