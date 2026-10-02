import { createClient } from '@/lib/supabase/client';
import { Attachment } from '@/types';
import { attachmentStoragePath } from './storagePath';

const MAX_WIDTH = 1200;
const MAX_HEIGHT = 1200;
const QUALITY = 0.8;
const MAX_SIZE_MB = 5;

export const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(img.src);

            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) {
                    height = Math.round((height * MAX_WIDTH) / width);
                    width = MAX_WIDTH;
                }
            } else if (height > MAX_HEIGHT) {
                width = Math.round((width * MAX_HEIGHT) / height);
                height = MAX_HEIGHT;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
            }

            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Compression failed'));
                }
            }, 'image/webp', QUALITY);
        };
        img.onerror = (error) => reject(error);
    });
};

export const uploadTaskAttachment = async (file: File, userId: string): Promise<Attachment> => {
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        throw new Error(`File size exceeds ${MAX_SIZE_MB}MB limit.`);
    }

    const isImage = file.type.startsWith('image/');
    let uploadData: Blob | File = file;
    let mimeType = file.type;
    let fileName = file.name;

    if (isImage) {
        try {
            const compressedBlob = await compressImage(file);
            uploadData = compressedBlob;
            mimeType = 'image/webp';
            fileName = fileName.replace(/\.[^/.]+$/, '') + '.webp';
        } catch (error) {
            console.warn('Image compression failed, uploading original:', error);
        }
    }

    const fileId = crypto.randomUUID();
    const path = attachmentStoragePath(userId, fileId, fileName);
    const supabase = createClient();

    const { error } = await supabase.storage.from('attachments').upload(path, uploadData, {
        contentType: mimeType,
        upsert: true,
    });
    if (error) {
        throw error;
    }

    // attachments バケットは private 化されたため公開URL（getPublicUrl）は 404 になり、描画に使えない。
    // 描画は都度 path から署名付きURLを生成する（getAttachmentSignedUrl / AttachmentImage）。
    // DB の url 列は NOT NULL のため、破綻しない値として storage_path を格納しておく。
    // この url はもはや描画の権威ではなく、削除・署名URL生成には必ず path を使う。
    return {
        id: fileId,
        url: path,
        path,
        name: fileName,
        type: isImage ? 'image' : 'file',
        size: uploadData.size,
        createdAt: Date.now(),
    };
};

// private 化した attachments バケットの storage_path から、短命（既定1時間）の署名付きURLを生成する。
// 描画時に呼び、公開URLの代わりに <img src> へ渡す。失敗時は null を返し、呼び出し側でフォールバックする。
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1時間
// 失効の少し手前までは同じ URL を使い回す。日付を行き来するたびに全画像の署名を
// 取り直し、しかも URL が毎回変わってブラウザの画像キャッシュが効かなかったため。
const SIGNED_URL_REUSE_MARGIN_MS = 5 * 60 * 1000;

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const signedUrlInFlight = new Map<string, Promise<string | null>>();

export const getAttachmentSignedUrl = async (
    path: string,
    expiresIn: number = SIGNED_URL_TTL_SECONDS
): Promise<string | null> => {
    if (!path) {
        return null;
    }

    const cacheKey = `${path}#${expiresIn}`;
    const cached = signedUrlCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.url;
    }

    // 同じ画像が同時に複数描画されても署名リクエストは 1 回にまとめる。
    const inFlight = signedUrlInFlight.get(cacheKey);
    if (inFlight) {
        return inFlight;
    }

    const request = (async () => {
        const { data, error } = await createClient()
            .storage.from('attachments')
            .createSignedUrl(path, expiresIn);

        if (error || !data) {
            console.error('Failed to create signed URL for attachment:', error);
            return null;
        }

        signedUrlCache.set(cacheKey, {
            url: data.signedUrl,
            expiresAt: Date.now() + expiresIn * 1000 - SIGNED_URL_REUSE_MARGIN_MS,
        });
        return data.signedUrl;
    })().finally(() => {
        signedUrlInFlight.delete(cacheKey);
    });
    signedUrlInFlight.set(cacheKey, request);
    return request;
};

/** 添付を消したときに古い署名 URL を残さないためのキャッシュ破棄。 */
export const forgetAttachmentSignedUrl = (path: string) => {
    for (const key of Array.from(signedUrlCache.keys())) {
        if (key.startsWith(`${path}#`)) {
            signedUrlCache.delete(key);
        }
    }
};

export const deleteAttachment = async (path: string): Promise<void> => {
    const { error } = await createClient().storage.from('attachments').remove([path]);
    if (error) {
        throw error;
    }
    forgetAttachmentSignedUrl(path);
};
