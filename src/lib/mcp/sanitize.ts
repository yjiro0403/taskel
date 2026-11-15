/**
 * Text checks for values an MCP caller asks Taskel to store.
 *
 * A title written through MCP is later read back by people and by other
 * agents, so characters that hide or reorder text are refused rather than
 * silently removed:
 *   - C0 controls (including tab and newline), DEL and C1 controls
 *   - zero-width characters, the byte order mark and the soft hyphen
 *   - bidirectional marks, embeddings, overrides and isolates
 *   - line and paragraph separators
 *   - invisible fillers and format characters: combining grapheme joiner
 *     (U+034F), Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), Khmer
 *     inherent vowels (U+17B4, U+17B5), Mongolian variation selectors and
 *     vowel separator (U+180B-180F), U+2060-206F, musical invisible format
 *     characters (U+1D173-1D17A)
 *   - the Unicode tag block (U+E0000-E007F), which hides ASCII text from
 *     people ("ASCII smuggling")
 * Emoji variation selectors (U+FE00-FE0F) and ideographic variation
 * selectors (U+E0100-E01EF) stay allowed: ordinary emoji and Japanese
 * name variants use them.
 */
const FORBIDDEN_TEXT =
    /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufeff\uffa0\u{1d173}-\u{1d17a}\u{e0000}-\u{e007f}]/u;

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
