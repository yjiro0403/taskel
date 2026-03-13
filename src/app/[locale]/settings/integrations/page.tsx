'use client';

import { useState, useEffect, useCallback } from 'react';
import SettingsLayout from '@/components/SettingsLayout';
import { auth } from '@/lib/firebase';
import {
    Plug,
    Copy,
    CheckCheck,
    RefreshCw,
    Eye,
    EyeOff,
    Loader2,
    AlertTriangle,
    Clock,
    ChevronDown,
    ChevronUp,
    Camera,
} from 'lucide-react';

const CONFIG_SAMPLE_RECOMMENDED = `{
  "mcpServers": {
    "taskel": {
      "command": "node",
      "args": ["/path/to/taskel-mcp-server/dist/index.js"],
      "env": {
        "TASKEL_REFRESH_TOKEN": "YOUR_REFRESH_TOKEN_HERE",
        "FIREBASE_API_KEY": "YOUR_FIREBASE_API_KEY_HERE",
        "FIREBASE_PROJECT_ID": "YOUR_FIREBASE_PROJECT_ID_HERE"
      }
    }
  }
}`;

const CONFIG_SAMPLE_LEGACY = `{
  "mcpServers": {
    "taskel": {
      "command": "node",
      "args": ["/path/to/taskel-mcp-server/dist/index.js"],
      "env": {
        "FIREBASE_PROJECT_ID": "your-firebase-project-id",
        "TASKEL_ID_TOKEN": "YOUR_ID_TOKEN_HERE"
      }
    }
  }
}`;

export default function IntegrationsSettingsPage() {
    // --- リフレッシュトークン ---
    const [refreshToken, setRefreshToken] = useState<string | null>(null);
    const [isRefreshVisible, setIsRefreshVisible] = useState(false);
    const [refreshCopyStatus, setRefreshCopyStatus] = useState<'idle' | 'copied'>('idle');
    const [refreshTokenError, setRefreshTokenError] = useState<string | null>(null);
    const [isLoadingRefresh, setIsLoadingRefresh] = useState(false);

    // --- ID Token（後方互換） ---
    const [idToken, setIdToken] = useState<string | null>(null);
    const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
    const [isLoadingToken, setIsLoadingToken] = useState(false);
    const [tokenError, setTokenError] = useState<string | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
    const [elapsedMinutes, setElapsedMinutes] = useState(0);

    // --- Firebase 公開値 ---
    const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '';
    const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '';
    const [apiKeyCopyStatus, setApiKeyCopyStatus] = useState<'idle' | 'copied'>('idle');
    const [projectIdCopyStatus, setProjectIdCopyStatus] = useState<'idle' | 'copied'>('idle');

    // --- UI 開閉状態 ---
    const [showSetupGuide, setShowSetupGuide] = useState(false);
    const [showLegacyConfig, setShowLegacyConfig] = useState(false);
    const [showLegacySection, setShowLegacySection] = useState(false);

    // ID Token の経過時間カウンター
    useEffect(() => {
        if (!fetchedAt) return;
        const interval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - fetchedAt.getTime()) / 60000);
            setElapsedMinutes(elapsed);
            if (elapsed >= 60) {
                setIdToken(null);
                setFetchedAt(null);
                setIsVisible(false);
                setElapsedMinutes(0);
            }
        }, 10000);
        return () => clearInterval(interval);
    }, [fetchedAt]);

    // リフレッシュトークン取得
    const fetchRefreshToken = useCallback(async () => {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            setRefreshTokenError('ログインが必要です。');
            return;
        }
        setIsLoadingRefresh(true);
        setRefreshTokenError(null);
        setIsRefreshVisible(false);
        try {
            const token = currentUser.refreshToken;
            if (!token) {
                setRefreshTokenError('リフレッシュトークンを取得できませんでした。再ログインを試してください。');
                return;
            }
            setRefreshToken(token);
        } catch {
            setRefreshTokenError('リフレッシュトークンの取得に失敗しました。再ログインを試してください。');
        } finally {
            setIsLoadingRefresh(false);
        }
    }, []);

    // ID Token 取得（後方互換）
    const fetchToken = useCallback(async () => {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            setTokenError('ログインが必要です。');
            return;
        }
        setIsLoadingToken(true);
        setTokenError(null);
        setIsVisible(false);
        try {
            const token = await currentUser.getIdToken(true);
            setIdToken(token);
            setFetchedAt(new Date());
            setElapsedMinutes(0);
        } catch {
            setTokenError('トークンの取得に失敗しました。再ログインを試してください。');
        } finally {
            setIsLoadingToken(false);
        }
    }, []);

    // リフレッシュトークン コピー
    const handleRefreshCopy = async () => {
        if (!refreshToken) return;
        try {
            await navigator.clipboard.writeText(refreshToken);
            setRefreshCopyStatus('copied');
            setTimeout(() => setRefreshCopyStatus('idle'), 2000);
            setTimeout(() => setIsRefreshVisible(false), 30000);
            setTimeout(() => {
                navigator.clipboard.writeText('').catch(() => {});
            }, 30000);
        } catch {
            setRefreshTokenError('クリップボードへのコピーに失敗しました。');
        }
    };

    // ID Token コピー（後方互換）
    const handleCopy = async () => {
        if (!idToken) return;
        try {
            await navigator.clipboard.writeText(idToken);
            setCopyStatus('copied');
            setTimeout(() => setCopyStatus('idle'), 2000);
            setTimeout(() => setIsVisible(false), 30000);
            setTimeout(() => {
                navigator.clipboard.writeText('').catch(() => {});
            }, 30000);
        } catch {
            setTokenError('クリップボードへのコピーに失敗しました。');
        }
    };

    // API Key コピー
    const handleApiKeyCopy = async () => {
        if (!firebaseApiKey) return;
        try {
            await navigator.clipboard.writeText(firebaseApiKey);
            setApiKeyCopyStatus('copied');
            setTimeout(() => setApiKeyCopyStatus('idle'), 2000);
        } catch {
            // silent
        }
    };

    // Project ID コピー
    const handleProjectIdCopy = async () => {
        if (!firebaseProjectId) return;
        try {
            await navigator.clipboard.writeText(firebaseProjectId);
            setProjectIdCopyStatus('copied');
            setTimeout(() => setProjectIdCopyStatus('idle'), 2000);
        } catch {
            // silent
        }
    };

    const maskedRefreshToken = refreshToken
        ? `${refreshToken.slice(0, 12)}${'•'.repeat(20)}${refreshToken.slice(-8)}`
        : null;

    const maskedIdToken = idToken
        ? `${idToken.slice(0, 12)}${'•'.repeat(20)}${idToken.slice(-8)}`
        : null;

    const isExpiringSoon = elapsedMinutes >= 50 && idToken !== null;

    return (
        <SettingsLayout>
            <div className="space-y-8">
                {/* ページヘッダー */}
                <div>
                    <h2 className="text-xl font-bold text-gray-900 mb-1">外部連携</h2>
                    <p className="text-sm text-gray-500">
                        外部ツールとのAPI連携を設定します。
                    </p>
                </div>

                {/* MCP連携セクション */}
                <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                        <div className="flex items-center gap-3">
                            <Plug size={20} className="text-gray-600" />
                            <div>
                                <h3 className="font-semibold text-gray-900">
                                    Taskel MCP Server
                                </h3>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    Claude Desktop から Taskel のタスク・目標データを参照できます
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="p-6 space-y-6">
                        {/* 推奨設定セクション */}
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                    推奨
                                </span>
                                <h4 className="text-sm font-semibold text-gray-800">推奨設定</h4>
                            </div>
                            <div className="space-y-4">
                                {/* リフレッシュトークン */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-sm font-medium text-gray-700">
                                            リフレッシュトークン（推奨）
                                        </label>
                                    </div>

                                    {refreshTokenError && (
                                        <div className="flex items-center gap-3 p-3 mb-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                                            <AlertTriangle size={16} className="shrink-0" />
                                            <span>{refreshTokenError}</span>
                                        </div>
                                    )}

                                    {refreshToken ? (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 font-mono text-xs bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-gray-700 overflow-hidden text-ellipsis whitespace-nowrap select-none">
                                                    {isRefreshVisible ? refreshToken : maskedRefreshToken}
                                                </div>
                                                <button
                                                    onClick={() => setIsRefreshVisible(!isRefreshVisible)}
                                                    className="p-2.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                                                    aria-label={isRefreshVisible ? 'トークンを隠す' : 'トークンを表示'}
                                                >
                                                    {isRefreshVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                                                </button>
                                                <button
                                                    onClick={handleRefreshCopy}
                                                    className="p-2.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                                                    aria-label="トークンをコピー"
                                                >
                                                    {refreshCopyStatus === 'copied' ? (
                                                        <CheckCheck size={16} className="text-green-600" />
                                                    ) : (
                                                        <Copy size={16} />
                                                    )}
                                                </button>
                                            </div>
                                            {isRefreshVisible && (
                                                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                                    <Camera size={13} className="shrink-0" />
                                                    <span>トークン表示中はスクリーンショットを避けてください。30秒後に自動マスクされます。</span>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center h-12 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-sm text-gray-400">
                                            「取得」ボタンを押してリフレッシュトークンを取得してください
                                        </div>
                                    )}

                                    <button
                                        onClick={fetchRefreshToken}
                                        disabled={isLoadingRefresh}
                                        className="mt-3 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {isLoadingRefresh ? (
                                            <Loader2 size={15} className="animate-spin" />
                                        ) : (
                                            <RefreshCw size={15} />
                                        )}
                                        {refreshToken ? 'リフレッシュトークンを再取得' : 'リフレッシュトークンを取得'}
                                    </button>
                                </div>

                                {/* Firebase API Key */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Firebase API Key
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 font-mono text-xs bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-gray-700 overflow-hidden text-ellipsis whitespace-nowrap">
                                            {firebaseApiKey || '（環境変数が設定されていません）'}
                                        </div>
                                        <button
                                            onClick={handleApiKeyCopy}
                                            disabled={!firebaseApiKey}
                                            className="p-2.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                            aria-label="API Keyをコピー"
                                        >
                                            {apiKeyCopyStatus === 'copied' ? (
                                                <CheckCheck size={16} className="text-green-600" />
                                            ) : (
                                                <Copy size={16} />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Firebase Project ID */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Firebase Project ID
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 font-mono text-xs bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-gray-700 overflow-hidden text-ellipsis whitespace-nowrap">
                                            {firebaseProjectId || '（環境変数が設定されていません）'}
                                        </div>
                                        <button
                                            onClick={handleProjectIdCopy}
                                            disabled={!firebaseProjectId}
                                            className="p-2.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                            aria-label="Project IDをコピー"
                                        >
                                            {projectIdCopyStatus === 'copied' ? (
                                                <CheckCheck size={16} className="text-green-600" />
                                            ) : (
                                                <Copy size={16} />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* セットアップガイド（折りたたみ） */}
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                            <button
                                onClick={() => setShowSetupGuide(!showSetupGuide)}
                                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                                <span>Claude Desktop セットアップ手順</span>
                                {showSetupGuide ? (
                                    <ChevronUp size={16} className="text-gray-400" />
                                ) : (
                                    <ChevronDown size={16} className="text-gray-400" />
                                )}
                            </button>
                            {showSetupGuide && (
                                <div className="border-t border-gray-200 p-4 bg-gray-50 space-y-3">
                                    <ol className="text-sm text-gray-600 space-y-1.5 list-decimal list-inside">
                                        <li>上の「リフレッシュトークンを取得」ボタンを押し、コピーボタンでコピーする</li>
                                        <li>Firebase API Key のコピーボタンを押してコピーする</li>
                                        <li>
                                            Claude Desktop の設定ファイルを開き、以下の内容を追加する（
                                            <code className="bg-gray-200 px-1 py-0.5 rounded text-xs">YOUR_REFRESH_TOKEN_HERE</code> 等を置き換える）
                                        </li>
                                    </ol>
                                    <pre className="bg-gray-900 text-gray-100 text-xs rounded-lg p-4 overflow-x-auto">
                                        <code>{CONFIG_SAMPLE_RECOMMENDED}</code>
                                    </pre>
                                    <p className="text-xs text-gray-400">
                                        設定ファイルの場所 — macOS:{' '}
                                        <code className="bg-gray-200 text-gray-600 px-1 rounded">
                                            ~/Library/Application Support/Claude/claude_desktop_config.json
                                        </code>
                                    </p>

                                    {/* 後方互換設定例（折りたたみ） */}
                                    <div className="border border-gray-300 rounded-lg overflow-hidden mt-2">
                                        <button
                                            onClick={() => setShowLegacyConfig(!showLegacyConfig)}
                                            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-100 transition-colors"
                                        >
                                            <span>後方互換設定例（ID Token 方式）</span>
                                            {showLegacyConfig ? (
                                                <ChevronUp size={13} className="text-gray-400" />
                                            ) : (
                                                <ChevronDown size={13} className="text-gray-400" />
                                            )}
                                        </button>
                                        {showLegacyConfig && (
                                            <div className="border-t border-gray-200 p-3 bg-white space-y-2">
                                                <p className="text-xs text-gray-400">
                                                    旧方式（非推奨）。ID Token は60分で失効するため、定期的な再設定が必要です。
                                                </p>
                                                <pre className="bg-gray-900 text-gray-100 text-xs rounded-lg p-3 overflow-x-auto">
                                                    <code>{CONFIG_SAMPLE_LEGACY}</code>
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {/* セキュリティ注意事項 */}
                <section className="bg-amber-50 rounded-xl border border-amber-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-amber-100">
                        <div className="flex items-center gap-2 text-amber-800">
                            <AlertTriangle size={18} />
                            <h3 className="font-semibold">セキュリティに関する注意</h3>
                        </div>
                    </div>
                    <div className="p-6">
                        <ul className="text-sm text-amber-800 space-y-2 list-disc list-inside">
                            <li>
                                リフレッシュトークンは長期間有効な認証情報です。ID Token よりも重要度が高く、漏洩した場合は即座に Firebase コンソールからセッションを無効化してください。
                            </li>
                            <li>IDトークン・リフレッシュトークンはあなたのアカウントへのアクセス権を含む秘密情報です。第三者に共有しないでください。</li>
                            <li>トークンが表示された画面のスクリーンショット共有・公開は避けてください。</li>
                            <li>IDトークンは取得から60分で自動的に失効します。リフレッシュトークン方式を推奨します。</li>
                            <li>Claude Desktop の設定ファイルはローカル環境に安全に保管してください。</li>
                        </ul>
                    </div>
                </section>

                {/* 従来方式（ID Token）— 後方互換 */}
                <section className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                        onClick={() => setShowLegacySection(!showLegacySection)}
                        className="w-full flex items-center justify-between px-6 py-4 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                        <span>従来方式（ID Token）— 後方互換・非推奨</span>
                        {showLegacySection ? (
                            <ChevronUp size={16} className="text-gray-400" />
                        ) : (
                            <ChevronDown size={16} className="text-gray-400" />
                        )}
                    </button>

                    {showLegacySection && (
                        <div className="border-t border-gray-200 p-6 bg-gray-50 space-y-5">
                            <p className="text-xs text-gray-500">
                                ID Token 方式は60分で失効するため、定期的な再設定が必要です。新規設定にはリフレッシュトークン方式を推奨します。
                            </p>

                            {/* 期限切れ警告 */}
                            {isExpiringSoon && (
                                <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                                    <AlertTriangle size={16} className="shrink-0" />
                                    <span>
                                        トークンの取得から{elapsedMinutes}分経過しています。まもなく期限切れになります。再取得を推奨します。
                                    </span>
                                </div>
                            )}

                            {/* エラー表示 */}
                            {tokenError && (
                                <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                                    <AlertTriangle size={16} className="shrink-0" />
                                    <span>{tokenError}</span>
                                </div>
                            )}

                            {/* ID Token 表示エリア */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-medium text-gray-700">
                                        Firebase ID トークン
                                    </label>
                                    {fetchedAt && (
                                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                                            <Clock size={12} />
                                            <span>
                                                取得から {elapsedMinutes}分 / 有効期限 60分
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {idToken ? (
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 font-mono text-xs bg-white border border-gray-200 rounded-lg px-4 py-3 text-gray-700 overflow-hidden text-ellipsis whitespace-nowrap select-none">
                                            {isVisible ? idToken : maskedIdToken}
                                        </div>
                                        <button
                                            onClick={() => setIsVisible(!isVisible)}
                                            className="p-2.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                                            aria-label={isVisible ? 'トークンを隠す' : 'トークンを表示'}
                                        >
                                            {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                        <button
                                            onClick={handleCopy}
                                            className="p-2.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                                            aria-label="トークンをコピー"
                                        >
                                            {copyStatus === 'copied' ? (
                                                <CheckCheck size={16} className="text-green-600" />
                                            ) : (
                                                <Copy size={16} />
                                            )}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center h-12 bg-white border border-dashed border-gray-300 rounded-lg text-sm text-gray-400">
                                        トークンを取得してください
                                    </div>
                                )}
                            </div>

                            {/* 取得/再取得ボタン */}
                            <button
                                onClick={fetchToken}
                                disabled={isLoadingToken}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                            >
                                {isLoadingToken ? (
                                    <Loader2 size={15} className="animate-spin" />
                                ) : (
                                    <RefreshCw size={15} />
                                )}
                                {idToken ? 'トークンを再取得' : 'トークンを取得'}
                            </button>
                        </div>
                    )}
                </section>
            </div>
        </SettingsLayout>
    );
}
