const RELATIVE_RE = /今日|明日|明後日|来週|今週|再来週|先週|来月|今月|tonight|tomorrow|today|next week|this week/i;
const CHANGE_RE = /変更|延期|やっぱり|いったん|リスケ|日程を動|から.{0,8}に変更/;
const TENTATIVE_RE = /仮予定|未定|調整中|暫定|TBD|tentative|maybe/i;
const NOTIFICATION_RE = /通知|送信時刻|既読|ステータスバー|スクリーンショットの時刻|チャットの送信/;

export function hasRelativeExpression(text: string | null | undefined): boolean {
    return Boolean(text && RELATIVE_RE.test(text));
}

export function hasScheduleChange(text: string | null | undefined): boolean {
    return Boolean(text && CHANGE_RE.test(text));
}

export function hasTentativeWording(text: string | null | undefined): boolean {
    return Boolean(text && TENTATIVE_RE.test(text));
}

export function mentionsNotificationTime(text: string | null | undefined): boolean {
    return Boolean(text && NOTIFICATION_RE.test(text));
}

/**
 * A place or zone other than the Tokyo default. JST / 日本時間 alone is Tokyo.
 * Mentioning both Tokyo and another zone is still uncertain.
 */
export function mentionsNonTokyoZone(text: string | null | undefined): boolean {
    if (!text) {
        return false;
    }
    const foreign = /ニューヨーク|ロンドン|ロサンゼルス|パリ|シンガポール|New York|London|Los Angeles|UTC|GMT|PST|PDT|EST|EDT|CET|太平洋標準|東部標準|America\/|Europe\//i;
    return foreign.test(text);
}
