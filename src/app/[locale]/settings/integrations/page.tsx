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
} from 'lucide-react';

const CONFIG_SAMPLE = `{
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
    const [idToken, setIdToken] = useState<string | null>(null);
    const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
    const [isLoadingToken, setIsLoadingToken] = useState(false);
    const [tokenError, setTokenError] = useState<string | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
    const [elapsedMinutes, setElapsedMinutes] = useState(0);
    const [showSetupGuide, setShowSetupGuide] = useState(false);

    // 経過時間カウンター
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

    // トークン取得（オンデマンド、forceRefresh: true）
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

    // コピー（マスク状態でも動作 — R-03準拠）
    const handleCopy = async () => {
        if (!idToken) return;
        try {
            await navigator.clipboard.writeText(idToken);
            setCopyStatus('copied');
            setTimeout(() => setCopyStatus('idle'), 2000);
            // 30秒後に自動マスク（REC-03準拠）
            setTimeout(() => setIsVisible(false), 30000);
            // 30秒後にクリップボードクリア試行（REC-01準拠）
            setTimeout(() => {
                navigator.clipboard.writeText('').catch(() => {});
            }, 30000);
        } catch {
            setTokenError('クリップボードへのコピーに失敗しました。');
        }
    };

    const maskedToken = idToken
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

                    <div className="p-6 space-y-5">
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

                        {/* トークン表示エリア */}
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
                                    <div className="flex-1 font-mono text-xs bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-gray-700 overflow-hidden text-ellipsis whitespace-nowrap select-none">
                                        {isVisible ? idToken : maskedToken}
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
                                <div className="flex items-center justify-center h-12 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-sm text-gray-400">
                                    トークンを取得してください
                                </div>
                            )}
                        </div>

                        {/* 取得/再取得ボタン */}
                        <button
                            onClick={fetchToken}
                            disabled={isLoadingToken}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                        >
                            {isLoadingToken ? (
                                <Loader2 size={15} className="animate-spin" />
                            ) : (
                                <RefreshCw size={15} />
                            )}
                            {idToken ? 'トークンを再取得' : 'トークンを取得'}
                        </button>

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
                                        <li>上の「トークンを取得」ボタンを押す</li>
                                        <li>コピーボタンでトークンをクリップボードにコピーする</li>
                                        <li>Claude Desktop の設定ファイルを開く</li>
                                        <li>
                                            以下の設定を追加し、<code className="bg-gray-200 px-1 py-0.5 rounded text-xs">YOUR_ID_TOKEN_HERE</code> にトークンを貼り付ける
                                        </li>
                                    </ol>
                                    <pre className="bg-gray-900 text-gray-100 text-xs rounded-lg p-4 overflow-x-auto">
                                        <code>{CONFIG_SAMPLE}</code>
                                    </pre>
                                    <p className="text-xs text-gray-400">
                                        設定ファイルの場所 — macOS:{' '}
                                        <code className="bg-gray-200 text-gray-600 px-1 rounded">
                                            ~/Library/Application Support/Claude/claude_desktop_config.json
                                        </code>
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {/* セキュリティ注意事項（REC-02準拠） */}
                <section className="bg-amber-50 rounded-xl border border-amber-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-amber-100">
                        <div className="flex items-center gap-2 text-amber-800">
                            <AlertTriangle size={18} />
                            <h3 className="font-semibold">セキュリティに関する注意</h3>
                        </div>
                    </div>
                    <div className="p-6">
                        <ul className="text-sm text-amber-800 space-y-2 list-disc list-inside">
                            <li>IDトークンはあなたのアカウントへのアクセス権を含む秘密情報です。第三者に共有しないでください。</li>
                            <li>トークンが表示された画面のスクリーンショット共有・公開は避けてください。</li>
                            <li>トークンは取得から60分で自動的に失効します。期限切れの場合は再取得してください。</li>
                            <li>Claude Desktop の設定ファイルはローカル環境に安全に保管してください。</li>
                        </ul>
                    </div>
                </section>
            </div>
        </SettingsLayout>
    );
}
