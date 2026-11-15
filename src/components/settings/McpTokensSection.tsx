'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Plug } from 'lucide-react';

import type { McpAuditEntry, McpTokenRecord } from '@/lib/mcp/db';
import {
    MCP_TOKEN_DEFAULT_EXPIRY_DAYS,
    MCP_TOKEN_EXPIRY_DAYS,
    type McpTokenAccess,
} from '@/lib/validations/mcpToken';

type ExpiryDays = (typeof MCP_TOKEN_EXPIRY_DAYS)[number];
type TokenStatus = 'active' | 'expired' | 'revoked';
type CopyTimer = { current: number | null };
type TokenList = { ready: boolean; tokens: McpTokenRecord[]; recent: McpAuditEntry[] };

const FIELD_CLASS = 'mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900';
const PRIMARY_BUTTON_CLASS = 'inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY_BUTTON_CLASS = 'inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60';
const HEADERS = ['名前', '接頭辞', '権限', 'タイムゾーン', '作成日', '最終使用', '有効期限', '状態', '操作'] as const;
const ISSUE_ERRORS: Record<number, string> = {
    409: '有効なトークンは 5 個までです。不要なトークンを取り消してください。',
    503: 'サーバーの準備がまだです',
    429: 'しばらく待ってからもう一度お試しください',
    401: 'ログインが必要です',
};
const STATUS_LABEL: Record<TokenStatus, string> = { revoked: '取り消し済み', expired: '期限切れ', active: '有効' };

function isExpiryDays(value: number): value is ExpiryDays {
    return (MCP_TOKEN_EXPIRY_DAYS as readonly number[]).includes(value);
}

function readTokenList(body: unknown): TokenList | null {
    if (typeof body !== 'object' || body === null || !('ready' in body) || !('tokens' in body) || !('recent' in body)) {
        return null;
    }
    if (typeof body.ready !== 'boolean' || !Array.isArray(body.tokens) || !Array.isArray(body.recent)) {
        return null;
    }
    return {
        ready: body.ready,
        tokens: body.tokens as McpTokenRecord[],
        recent: (body.recent as McpAuditEntry[]).slice(0, 20),
    };
}

function readIssuedToken(body: unknown): string | null {
    if (typeof body !== 'object' || body === null || !('token' in body)) {
        return null;
    }
    return typeof body.token === 'string' && body.token.length > 0 ? body.token : null;
}

const formatDateTime = (value: string) => new Date(value).toLocaleString('ja-JP');
const accessLabel = (scopes: readonly string[]) => (scopes.includes('tasks:create') ? '読み取り＋追加' : '読み取り');

function tokenStatus(token: McpTokenRecord, now: number): TokenStatus {
    if (token.revoked_at !== null) {
        return 'revoked';
    }
    const expiresAt = new Date(token.expires_at).getTime();
    return Number.isNaN(expiresAt) || expiresAt < now ? 'expired' : 'active';
}

function resultLabel(entry: McpAuditEntry): string {
    if (entry.ok) {
        return '成功';
    }
    return entry.error_code !== null && entry.error_code.length > 0 ? entry.error_code : '失敗';
}

function markCopied(timer: CopyTimer, setCopied: (copied: boolean) => void): void {
    setCopied(true);
    if (timer.current !== null) {
        window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => {
        timer.current = null;
        setCopied(false);
    }, 2000);
}

function rowValues(token: McpTokenRecord, now: number): string[] {
    return [
        token.name,
        token.prefix,
        accessLabel(token.scopes),
        token.timezone,
        formatDateTime(token.created_at),
        token.last_used_at === null ? '未使用' : formatDateTime(token.last_used_at),
        formatDateTime(token.expires_at),
        STATUS_LABEL[tokenStatus(token, now)],
    ];
}

export default function McpTokensSection() {
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [hasList, setHasList] = useState(false);
    const [ready, setReady] = useState(false);
    const [tokens, setTokens] = useState<McpTokenRecord[]>([]);
    const [recent, setRecent] = useState<McpAuditEntry[]>([]);
    const [endpoint, setEndpoint] = useState('');
    const [endpointCopied, setEndpointCopied] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [formOpen, setFormOpen] = useState(false);
    const [name, setName] = useState('Beacon');
    const [access, setAccess] = useState<McpTokenAccess>('read_create');
    const [expiresInDays, setExpiresInDays] = useState<ExpiryDays>(MCP_TOKEN_DEFAULT_EXPIRY_DAYS);
    const [issuing, setIssuing] = useState(false);
    const [issueError, setIssueError] = useState<string | null>(null);
    const [issuedToken, setIssuedToken] = useState<string | null>(null);
    const [tokenCopied, setTokenCopied] = useState(false);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    const [revokeError, setRevokeError] = useState<string | null>(null);
    const mounted = useRef(true);
    const endpointCopyTimer = useRef<number | null>(null);
    const tokenCopyTimer = useRef<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setLoadError(false);
            setEndpoint(`${window.location.origin}/api/mcp`);
            try {
                const response = await fetch('/api/mcp/tokens', { cache: 'no-store' });
                const list = response.ok ? readTokenList(await response.json()) : null;
                if (list === null) {
                    throw new Error('load failed');
                }
                if (cancelled) {
                    return;
                }
                setReady(list.ready);
                setTokens(list.tokens);
                setRecent(list.recent);
                setHasList(true);
            } catch {
                if (!cancelled) {
                    setLoadError(true);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [reloadKey]);

    useEffect(() => {
        mounted.current = true;
        const endpointTimer = endpointCopyTimer;
        const tokenTimer = tokenCopyTimer;
        return () => {
            mounted.current = false;
            if (endpointTimer.current !== null) {
                window.clearTimeout(endpointTimer.current);
            }
            if (tokenTimer.current !== null) {
                window.clearTimeout(tokenTimer.current);
            }
            // The plaintext lives only in this state. Drop it when the screen goes away.
            setIssuedToken(null);
        };
    }, []);

    const reload = () => setReloadKey((key) => key + 1);

    const copyText = async (value: string, timer: CopyTimer, setCopied: (copied: boolean) => void) => {
        try {
            await navigator.clipboard.writeText(value);
            markCopied(timer, setCopied);
        } catch {
            setCopied(false);
        }
    };

    const closeIssuedToken = () => {
        if (tokenCopyTimer.current !== null) {
            window.clearTimeout(tokenCopyTimer.current);
            tokenCopyTimer.current = null;
        }
        setTokenCopied(false);
        setIssuedToken(null);
    };

    const openForm = () => {
        setName('Beacon');
        setAccess('read_create');
        setExpiresInDays(MCP_TOKEN_DEFAULT_EXPIRY_DAYS);
        setIssueError(null);
        setFormOpen(true);
    };

    const issueToken = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed.length === 0 || issuing || !ready) {
            return;
        }
        setIssuing(true);
        setIssueError(null);
        try {
            const response = await fetch('/api/mcp/tokens', {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: trimmed,
                    access,
                    expiresInDays,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }),
            });
            if (!mounted.current) {
                return;
            }
            if (!response.ok) {
                setIssueError(ISSUE_ERRORS[response.status] ?? '発行に失敗しました');
                return;
            }
            const token = readIssuedToken(await response.json());
            if (!mounted.current) {
                return;
            }
            if (token === null) {
                setIssueError('発行に失敗しました');
                return;
            }
            setTokenCopied(false);
            setIssuedToken(token);
            setFormOpen(false);
            setReloadKey((key) => key + 1);
        } catch {
            if (mounted.current) {
                setIssueError('発行に失敗しました');
            }
        } finally {
            if (mounted.current) {
                setIssuing(false);
            }
        }
    };

    const revokeToken = async (id: string) => {
        if (!window.confirm('このトークンを取り消しますか？取り消すと元に戻せません。')) {
            return;
        }
        setRevokingId(id);
        setRevokeError(null);
        try {
            const response = await fetch(`/api/mcp/tokens/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                cache: 'no-store',
            });
            if (!mounted.current) {
                return;
            }
            if (!response.ok) {
                setRevokeError('取り消しに失敗しました');
                return;
            }
            setReloadKey((key) => key + 1);
        } catch {
            if (mounted.current) {
                setRevokeError('取り消しに失敗しました');
            }
        } finally {
            if (mounted.current) {
                setRevokingId(null);
            }
        }
    };

    const now = Date.now();
    const showInitialSpinner = loading && !hasList;

    return (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-gray-50 px-6 py-4">
                <div className="flex items-center gap-3">
                    <Plug size={20} className="text-gray-600" aria-hidden="true" />
                    <div>
                        <h3 className="font-semibold text-gray-900">MCP トークン</h3>
                        <p className="mt-0.5 text-xs text-gray-500">
                            Beacon などの外部ツールが Taskel のタスクを読む・追加するためのトークンを発行します
                        </p>
                    </div>
                </div>
            </div>

            <div className="space-y-6 p-6">
                <div>
                    <div className="mb-2 text-sm font-medium text-gray-700">エンドポイント</div>
                    <div className="flex items-center gap-2">
                        <div className="min-h-12 flex-1 break-all rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-xs text-gray-700">
                            {endpoint || '読み込み中'}
                        </div>
                        <button
                            type="button"
                            onClick={() => void copyText(endpoint, endpointCopyTimer, setEndpointCopied)}
                            disabled={endpoint === ''}
                            className={SECONDARY_BUTTON_CLASS}
                        >
                            {endpointCopied ? 'コピーしました' : 'コピー'}
                        </button>
                    </div>
                </div>

                {hasList && !ready && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        <p className="font-medium">サーバーの準備がまだです</p>
                        <p className="mt-1">データベースのマイグレーションがまだ適用されていません。</p>
                    </div>
                )}

                {showInitialSpinner && (
                    <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                        <span>読み込み中</span>
                    </div>
                )}

                {loadError && (
                    <div className="flex flex-wrap items-center gap-3 text-sm text-red-700">
                        <span>読み込みに失敗しました</span>
                        <button type="button" onClick={reload} className={SECONDARY_BUTTON_CLASS}>再読み込み</button>
                    </div>
                )}

                {hasList && (
                    <>
                        {tokens.length === 0 ? (
                            <p className="text-sm text-gray-500">トークンはまだありません</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                                            {HEADERS.map((header) => (
                                                <th key={header} className="whitespace-nowrap px-2 py-2 font-medium">{header}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tokens.map((token) => {
                                            const status = tokenStatus(token, now);
                                            return (
                                                <tr key={token.id} className="border-b border-gray-100 last:border-0">
                                                    {rowValues(token, now).map((value, index) => (
                                                        <td
                                                            key={HEADERS[index]}
                                                            className={`whitespace-nowrap px-2 py-3 text-gray-700 ${index === 1 ? 'font-mono text-xs' : ''}`}
                                                        >
                                                            {value}
                                                        </td>
                                                    ))}
                                                    <td className="whitespace-nowrap px-2 py-3">
                                                        {status === 'active' && (
                                                            <button
                                                                type="button"
                                                                onClick={() => void revokeToken(token.id)}
                                                                disabled={revokingId !== null}
                                                                className="text-sm font-medium text-red-700 hover:text-red-900 disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                取り消す
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {revokeError !== null && <p className="text-sm text-red-700">{revokeError}</p>}

                        {!formOpen && (
                            <button type="button" onClick={openForm} disabled={!ready || loading} className={PRIMARY_BUTTON_CLASS}>
                                トークンを発行
                            </button>
                        )}

                        {formOpen && (
                            <form onSubmit={(event) => void issueToken(event)} className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <label className="block text-sm font-medium text-gray-700">
                                    名前
                                    <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoComplete="off" className={FIELD_CLASS} />
                                </label>
                                <fieldset>
                                    <legend className="text-sm font-medium text-gray-700">権限</legend>
                                    <div className="mt-2 flex flex-col gap-2">
                                        <label className="flex items-center gap-2 text-sm text-gray-800">
                                            <input type="radio" name="mcp-token-access" checked={access === 'read_create'} onChange={() => setAccess('read_create')} />
                                            読み取り＋追加
                                        </label>
                                        <label className="flex items-center gap-2 text-sm text-gray-800">
                                            <input type="radio" name="mcp-token-access" checked={access === 'read'} onChange={() => setAccess('read')} />
                                            読み取り
                                        </label>
                                    </div>
                                </fieldset>
                                <label className="block text-sm font-medium text-gray-700">
                                    有効期限
                                    <select
                                        value={expiresInDays}
                                        onChange={(event) => {
                                            const days = Number(event.target.value);
                                            if (isExpiryDays(days)) {
                                                setExpiresInDays(days);
                                            }
                                        }}
                                        className={FIELD_CLASS}
                                    >
                                        {MCP_TOKEN_EXPIRY_DAYS.map((days) => (
                                            <option key={days} value={days}>{days} 日</option>
                                        ))}
                                    </select>
                                </label>
                                {issueError !== null && <p className="text-sm text-red-700">{issueError}</p>}
                                <div className="flex flex-wrap gap-2">
                                    <button type="submit" disabled={issuing || !ready || name.trim().length === 0} className={PRIMARY_BUTTON_CLASS}>
                                        {issuing && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                                        発行する
                                    </button>
                                    <button type="button" onClick={() => { setFormOpen(false); setIssueError(null); }} disabled={issuing} className={SECONDARY_BUTTON_CLASS}>
                                        キャンセル
                                    </button>
                                </div>
                            </form>
                        )}

                        <div>
                            <h4 className="mb-2 text-sm font-semibold text-gray-900">最近の利用</h4>
                            {recent.length === 0 ? (
                                <p className="text-sm text-gray-500">まだ記録はありません</p>
                            ) : (
                                <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                                    {recent.map((entry, index) => (
                                        <li key={`${entry.created_at}-${entry.event}-${entry.token_id ?? 'none'}-${index}`} className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 text-sm text-gray-700">
                                            <span>{formatDateTime(entry.created_at)}</span>
                                            <span>{entry.event}</span>
                                            <span>{entry.tool ?? '-'}</span>
                                            <span>{resultLabel(entry)}</span>
                                            <span className="font-mono text-xs">{entry.token_prefix ?? '-'}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </>
                )}

                {issuedToken !== null && (
                    <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4">
                        <h4 className="font-semibold text-green-900">トークンを発行しました</h4>
                        <p className="text-sm text-green-800">このトークンは今だけ表示されます。閉じると二度と表示できません。</p>
                        <textarea
                            readOnly
                            rows={3}
                            value={issuedToken}
                            aria-label="発行したトークン"
                            spellCheck={false}
                            className="w-full select-all break-all rounded-lg border border-green-200 bg-white px-3 py-2 font-mono text-xs text-gray-900"
                        />
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    if (issuedToken !== null) {
                                        void copyText(issuedToken, tokenCopyTimer, setTokenCopied);
                                    }
                                }}
                                className={SECONDARY_BUTTON_CLASS}
                            >
                                {tokenCopied ? 'コピーしました' : 'コピー'}
                            </button>
                            <button type="button" onClick={closeIssuedToken} className={SECONDARY_BUTTON_CLASS}>閉じる</button>
                        </div>
                        <p className="text-sm text-green-900">
                            この Mac で <code className="rounded border border-green-200 bg-white px-1.5 py-0.5 font-mono text-xs">npm run beacon:taskel-link</code> を実行して貼り付ける
                        </p>
                    </div>
                )}
            </div>
        </section>
    );
}
