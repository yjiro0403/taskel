/**
 * Text checks for values an MCP caller asks Taskel to store.
 *
 * A title written through MCP is later read back by people and by other
 * agents, so characters that hide or reorder text are refused rather than
 * silently removed:
 *   - C0 controls (including tab and newline), DEL and C1 controls
 *   - zero-width characters and the byte order mark
 *   - bidirectional marks, embeddings, overrides and isolates
 *   - line and paragraph separators
 */
const FORBIDDEN_TEXT =
    /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;

export function hasForbiddenTextChars(value: string): boolean {
    return FORBIDDEN_TEXT.test(value);
}

export type CleanTitle = { ok: true; title: string } | { ok: false };

/** Trims a task title and accepts it only when it is 1..200 chars of plain text. */
export function cleanTaskTitle(value: unknown): CleanTitle {
    if (typeof value !== 'string') {
        return { ok: false };
    }
    // Length is counted the way Postgres char_length counts it: by code point.
    if (Array.from(value).length > 200) {
        return { ok: false };
    }
    const title = value.trim();
    if (title.length < 1 || hasForbiddenTextChars(title)) {
        return { ok: false };
    }
    return { ok: true, title };
}
