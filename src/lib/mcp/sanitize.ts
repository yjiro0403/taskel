/**
 * Text checks for values an MCP caller asks Taskel to store.
 *
 * A title written through MCP is later read back by people and by other
 * agents, so characters that hide or reorder text are refused rather than
 * silently removed:
 *   - every control character (\p{Cc}: C0 including tab and newline, DEL, C1)
 *   - every format character (\p{Cf}): zero-width characters, the byte order
 *     mark, the soft hyphen, bidirectional marks, embeddings, overrides and
 *     isolates, U+2060-206F, interlinear annotation controls (U+FFF9-FFFB),
 *     shorthand, Egyptian, Brahmi and Arabic number format controls, musical
 *     invisible format characters and the assigned Unicode tag characters
 *   - line and paragraph separators (\p{Zl}, \p{Zp})
 *   - lone surrogates (\p{Cs}), which are not valid text
 *   - invisible characters outside \p{Cf}: combining grapheme joiner
 *     (U+034F), Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), Khmer
 *     inherent vowels (U+17B4, U+17B5), Mongolian variation selectors and
 *     vowel separator (U+180B-180F), the unassigned U+2065, U+FFF0-FFF8, and
 *     the whole tag and selector planes outside the ideographic variation
 *     selectors (U+E0000-E00FF, U+E01F0-E0FFF), which hide ASCII text from
 *     people ("ASCII smuggling")
 *
 * Variation selectors (U+FE00-FE0F, U+E0100-E01EF) are allowed only where
 * they pick a glyph, because a run of them can carry hidden bytes ("emoji
 * smuggling"). The rule mirrors Beacon's collapseVariationSelectors, but
 * refuses instead of dropping:
 *   - a selector must come directly after a character that is not itself a
 *     selector (not first, not after another selector);
 *   - U+FE0E / U+FE0F need an emoji base; an ASCII emoji base (0-9 # *) also
 *     needs the keycap U+20E3 right after the selector;
 *   - U+FE00-FE0D and U+E0100-E01EF need a Han base, at most
 *     MAX_IDEOGRAPHIC_SELECTORS per value.
 */
const FORBIDDEN_TEXT =
    /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}͏ᅟᅠ឴឵᠋-᠏⁠-⁯ㅤﾠ￰-￸\u{1d173}-\u{1d17a}\u{e0000}-\u{e00ff}\u{e01f0}-\u{e0fff}]/u;

const EMOJI_BASE = /^\p{Emoji}$/u;
const HAN_BASE = /^\p{Script=Han}$/u;
const KEYCAP = '⃣';
/** Same cap as Beacon's TASKEL_IDEOGRAPHIC_VS_MAX. */
const MAX_IDEOGRAPHIC_SELECTORS = 2;

function isVariationSelector(code: number): boolean {
    return (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef);
}

/** True when a variation selector appears where it does not pick a glyph. */
function hasMisplacedVariationSelector(value: string): boolean {
    const chars = Array.from(value);
    let ideographic = 0;
    for (let index = 0; index < chars.length; index += 1) {
        const code = chars[index].codePointAt(0) ?? 0;
        if (!isVariationSelector(code)) {
            continue;
        }
        if (index === 0) {
            return true;
        }
        const before = chars[index - 1];
        const beforeCode = before.codePointAt(0) ?? 0;
        if (isVariationSelector(beforeCode)) {
            return true;
        }
        if (code === 0xfe0e || code === 0xfe0f) {
            if (!EMOJI_BASE.test(before)) {
                return true;
            }
            if (beforeCode < 0x80 && chars[index + 1] !== KEYCAP) {
                return true;
            }
            continue;
        }
        if (!HAN_BASE.test(before)) {
            return true;
        }
        ideographic += 1;
        if (ideographic > MAX_IDEOGRAPHIC_SELECTORS) {
            return true;
        }
    }
    return false;
}

export function hasForbiddenTextChars(value: string): boolean {
    return FORBIDDEN_TEXT.test(value) || hasMisplacedVariationSelector(value);
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
