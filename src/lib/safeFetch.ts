import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * SSRF 対策付きの fetch。
 *
 * AI ツール（analyzeUrl 等）はタスクメモ内の指示（＝プロンプトインジェクション
 * 経由）で任意 URL を叩き得るため、そのままサーバー側 fetch すると内部サービスや
 * クラウドのメタデータエンドポイント（169.254.169.254）への到達に悪用される。
 *
 * 防御:
 *  - スキームを http/https に限定
 *  - ホスト名を解決し、プライベート/ループバック/リンクローカル/CGNAT の IP を拒否
 *  - リダイレクトを禁止（redirect: 'error'）してリダイレクト経由の内部ピボットを封じる
 *
 * 注意: 解決後に再解決される DNS リバインディングまでは防げない（本アプリの脅威
 * モデルでは許容）。厳密性が必要なら IP 検証付きの undici dispatcher へ置き換える。
 */

function ipv4ToInt(ip: string): number {
    return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
    const n = ipv4ToInt(ip);
    const inRange = (base: string, bits: number) => {
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        return (n & mask) === (ipv4ToInt(base) & mask);
    };
    return (
        inRange('0.0.0.0', 8) ||        // 現在のネットワーク
        inRange('10.0.0.0', 8) ||       // プライベート
        inRange('100.64.0.0', 10) ||    // CGNAT
        inRange('127.0.0.0', 8) ||      // ループバック
        inRange('169.254.0.0', 16) ||   // リンクローカル（メタデータ）
        inRange('172.16.0.0', 12) ||    // プライベート
        inRange('192.0.0.0', 24) ||     // IETF プロトコル割当
        inRange('192.168.0.0', 16) ||   // プライベート
        inRange('198.18.0.0', 15) ||    // ベンチマーク
        inRange('224.0.0.0', 4) ||      // マルチキャスト
        inRange('240.0.0.0', 4)         // 予約
    );
}

function isPrivateIPv6(ip: string): boolean {
    const addr = ip.toLowerCase();
    if (addr === '::1' || addr === '::') return true;
    if (addr.startsWith('fe80') || addr.startsWith('fc') || addr.startsWith('fd')) return true;
    // IPv4-mapped (::ffff:a.b.c.d)
    const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    return false;
}

function isBlockedAddress(ip: string): boolean {
    if (net.isIPv4(ip)) return isPrivateIPv4(ip);
    if (net.isIPv6(ip)) return isPrivateIPv6(ip);
    return true; // 判定不能は拒否
}

export async function assertPublicUrl(rawUrl: string): Promise<URL> {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('Invalid URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only http/https URLs are allowed');
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // IPv6 の角括弧除去

    // ホスト名が直接 IP の場合はそのまま検証
    if (net.isIP(hostname)) {
        if (isBlockedAddress(hostname)) throw new Error('Access to private addresses is blocked');
        return parsed;
    }

    // DNS 解決して全アドレスを検証
    const records = await dns.lookup(hostname, { all: true });
    if (records.length === 0) throw new Error('Host could not be resolved');
    for (const rec of records) {
        if (isBlockedAddress(rec.address)) {
            throw new Error('Access to private addresses is blocked');
        }
    }

    return parsed;
}

/**
 * SSRF 検証済みの fetch。リダイレクトは禁止。
 */
export async function safeFetch(rawUrl: string, init?: RequestInit): Promise<Response> {
    const url = await assertPublicUrl(rawUrl);
    return fetch(url, { ...init, redirect: 'error' });
}
