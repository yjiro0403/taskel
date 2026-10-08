import { createHash } from 'node:crypto';

export function sha256Hex(value: string | Uint8Array): string {
    const hash = createHash('sha256');
    if (typeof value === 'string') {
        hash.update(value);
    } else {
        hash.update(value);
    }
    return hash.digest('hex');
}

/** Google Calendar event ids may only use [a-v0-9] and must be 5–1024 chars. */
export function googleEventIdForIntake(intakeId: string): string {
    const hex = sha256Hex(`taskel-schedule:${intakeId}`);
    return `t${hex.slice(0, 40)}`;
}

export function isGoogleEventId(value: string): boolean {
    return /^[a-v0-9]{5,1024}$/.test(value);
}

export function contentHashForText(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return `text:${sha256Hex(normalized)}`;
}

export function contentHashForImage(bytes: Uint8Array): string {
    return `image:${sha256Hex(bytes)}`;
}
