/**
 * 日付解決ヘルパー
 * 自然言語やヒント文字列をYYYY-MM-DD形式に解決する
 */

import { format, addDays, nextMonday, nextFriday, parseISO } from 'date-fns';

/**
 * 自然言語やヒント文字列を YYYY-MM-DD 形式に解決する。
 * 解決できない場合は baseDate を返す。
 */
export function resolveDate(dateStr: string | undefined, baseDate: string): string {
  if (!dateStr) return baseDate;
  const lower = dateStr.toLowerCase();
  const base = parseISO(baseDate);

  // 「今日」
  if (lower === '今日' || lower === 'today') return baseDate;
  // 「明日」
  if (lower === '明日' || lower === 'tomorrow') return format(addDays(base, 1), 'yyyy-MM-dd');
  // 「明後日」
  if (lower === '明後日' || lower === 'day after tomorrow') return format(addDays(base, 2), 'yyyy-MM-dd');
  // 「来週の月曜」
  if (lower.includes('来週の月曜') || lower.includes('next monday')) return format(nextMonday(base), 'yyyy-MM-dd');
  // 「来週の金曜」
  if (lower.includes('来週の金曜') || lower.includes('next friday')) return format(nextFriday(base), 'yyyy-MM-dd');

  // YYYY-MM-DD形式ならそのまま返す
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  // 解決できない場合は今日
  return baseDate;
}
