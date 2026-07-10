/**
 * ユーザー入力をメール本文などの HTML に埋め込む前にエスケープする。
 * プロジェクト名・表示名・メールアドレス等、ユーザーが自由に設定できる値を
 * 生の HTML に差し込むと、HTML/コンテンツインジェクション（配送型フィッシング）
 * の原因になるため、必ずこの関数を通すこと。
 */
export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
