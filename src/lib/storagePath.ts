/**
 * Supabase Storage object keys only allow a limited ASCII set
 * (letters, digits, and a few punctuation marks). Japanese, fullwidth
 * punctuation, and most symbols make upload fail with `Invalid key`.
 * Keep the original name on Attachment.name for display; the object
 * key is just `{uuid}.{ext}`.
 */
export function attachmentStoragePath(userId: string, fileId: string, fileName: string): string {
    const extMatch = fileName.match(/\.([A-Za-z0-9]{1,8})$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'bin';
    return `users/${userId}/attachments/${fileId}.${ext}`;
}
