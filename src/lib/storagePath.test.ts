import { describe, expect, it } from 'vitest';

import { attachmentStoragePath } from './storagePath';

describe('attachmentStoragePath', () => {
    const userId = 'd6c25a7f-209c-47b9-94b0-0229f233a331';
    const fileId = '27cdf40a-8fff-44b2-b58a-078aa5e8c0ea';

    it('uses only ASCII uuid + extension in the object key', () => {
        expect(
            attachmentStoragePath(
                userId,
                fileId,
                'ご購入頂きありがとうございました！ - SATUR - チェックアウト.webp'
            )
        ).toBe(`users/${userId}/attachments/${fileId}.webp`);
    });

    it('lowercases a safe extension', () => {
        expect(attachmentStoragePath(userId, fileId, 'Photo.PNG')).toBe(
            `users/${userId}/attachments/${fileId}.png`
        );
    });

    it('falls back to bin when the extension is missing or unsafe', () => {
        expect(attachmentStoragePath(userId, fileId, 'no-extension')).toBe(
            `users/${userId}/attachments/${fileId}.bin`
        );
        expect(attachmentStoragePath(userId, fileId, 'file.tar.gz')).toBe(
            `users/${userId}/attachments/${fileId}.gz`
        );
        expect(attachmentStoragePath(userId, fileId, 'weird.ファイル')).toBe(
            `users/${userId}/attachments/${fileId}.bin`
        );
    });
});
