/**
 * Drop metadata that can carry location or device identity.
 * JPEG APP1 (EXIF) and comment segments, and PNG text / eXIf chunks.
 * Pixel data is kept. This does not resize.
 */

function concat(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function readU16(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset] * 0x1000000)
        + (bytes[offset + 1] << 16)
        + (bytes[offset + 2] << 8)
        + bytes[offset + 3]
    ) >>> 0;
}

export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        return bytes;
    }
    const parts: Uint8Array[] = [bytes.subarray(0, 2)];
    let offset = 2;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) {
            parts.push(bytes.subarray(offset));
            offset = bytes.length;
            break;
        }
        const marker = bytes[offset + 1];
        if (marker === 0xd9 || marker === 0xda) {
            parts.push(bytes.subarray(offset));
            offset = bytes.length;
            break;
        }
        // Standalone markers without a length (TEM, RSTn).
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            parts.push(bytes.subarray(offset, offset + 2));
            offset += 2;
            continue;
        }
        const length = readU16(bytes, offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length) {
            parts.push(bytes.subarray(offset));
            break;
        }
        const segmentEnd = offset + 2 + length;
        const isExif = marker === 0xe1;
        const isComment = marker === 0xfe;
        const isIptc = marker === 0xed;
        if (!isExif && !isComment && !isIptc) {
            parts.push(bytes.subarray(offset, segmentEnd));
        }
        offset = segmentEnd;
    }
    if (offset < bytes.length) {
        parts.push(bytes.subarray(offset));
    }
    return concat(parts);
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function isPng(bytes: Uint8Array): boolean {
    if (bytes.length < 8) {
        return false;
    }
    return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
    if (!isPng(bytes)) {
        return bytes;
    }
    const parts: Uint8Array[] = [bytes.subarray(0, 8)];
    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const length = readU32(bytes, offset);
        const type = String.fromCharCode(
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        );
        const chunkEnd = offset + 12 + length;
        if (chunkEnd > bytes.length) {
            parts.push(bytes.subarray(offset));
            break;
        }
        const drop = type === 'eXIf' || type === 'tEXt' || type === 'iTXt' || type === 'zTXt';
        if (!drop) {
            parts.push(bytes.subarray(offset, chunkEnd));
        }
        offset = chunkEnd;
        if (type === 'IEND') {
            break;
        }
    }
    return concat(parts);
}

export function stripImageMetadata(bytes: Uint8Array, mime: string): Uint8Array {
    if (mime === 'image/jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8)) {
        return stripJpegMetadata(bytes);
    }
    if (mime === 'image/png' || isPng(bytes)) {
        return stripPngMetadata(bytes);
    }
    return bytes;
}
