import { describe, expect, it } from 'vitest';

import { cleanTaskTitle, hasForbiddenTextChars } from './sanitize';

const cp = (code: number) => String.fromCodePoint(code);

describe('cleanTaskTitle', () => {
    it('trims and accepts plain text in any script', () => {
        expect(cleanTaskTitle('  請求書を送る  ')).toEqual({ ok: true, title: '請求書を送る' });
        expect(cleanTaskTitle('Buy milk (2L) & eggs!')).toEqual({ ok: true, title: 'Buy milk (2L) & eggs!' });
        expect(cleanTaskTitle('会議　資料 🎉')).toEqual({ ok: true, title: '会議　資料 🎉' });
    });

    it('accepts 200 characters and refuses 201', () => {
        expect(cleanTaskTitle('あ'.repeat(200))).toEqual({ ok: true, title: 'あ'.repeat(200) });
        expect(cleanTaskTitle('あ'.repeat(201))).toEqual({ ok: false });
        // Counted by code point, like Postgres char_length.
        expect(cleanTaskTitle('🎉'.repeat(200)).ok).toBe(true);
        expect(cleanTaskTitle('🎉'.repeat(201)).ok).toBe(false);
    });

    it.each(['', '   ', '\n\t', 7, null, undefined, {}])('refuses the empty or non-string title %j', (value) => {
        expect(cleanTaskTitle(value)).toEqual({ ok: false });
    });

    it.each([
        ['NUL', 0x00],
        ['backspace', 0x08],
        ['tab', 0x09],
        ['newline', 0x0a],
        ['carriage return', 0x0d],
        ['escape', 0x1b],
        ['DEL', 0x7f],
        ['C1 control', 0x85],
        ['C1 control (CSI)', 0x9b],
        ['soft hyphen', 0xad],
        ['Arabic letter mark', 0x61c],
        ['zero-width space', 0x200b],
        ['zero-width non-joiner', 0x200c],
        ['zero-width joiner', 0x200d],
        ['left-to-right mark', 0x200e],
        ['right-to-left mark', 0x200f],
        ['line separator', 0x2028],
        ['paragraph separator', 0x2029],
        ['LRE', 0x202a],
        ['RLE', 0x202b],
        ['PDF', 0x202c],
        ['LRO', 0x202d],
        ['RLO', 0x202e],
        ['word joiner', 0x2060],
        ['LRI', 0x2066],
        ['RLI', 0x2067],
        ['FSI', 0x2068],
        ['PDI', 0x2069],
        ['byte order mark', 0xfeff],
    ])('refuses a title with %s inside', (_name, code) => {
        const title = `pay${cp(code)}invoice`;
        expect(hasForbiddenTextChars(title)).toBe(true);
        expect(cleanTaskTitle(title)).toEqual({ ok: false });
    });

    it('does not strip a hidden character and store the rest', () => {
        const result = cleanTaskTitle(`safe${cp(0x202e)}txt.exe`);
        expect(result).toEqual({ ok: false });
    });
});
