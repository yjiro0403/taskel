'use client';

import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

import { useStore } from '@/store/useStore';
import type { Toast, ToastType } from '@/store/types';

// 自動消滅までの時間（ms）
const AUTO_DISMISS_MS = 4000;

const TOAST_STYLES: Record<ToastType, string> = {
    success: 'bg-green-50 text-green-800 border-green-200',
    error: 'bg-red-50 text-red-800 border-red-200',
    info: 'bg-gray-900 text-white border-gray-800',
};

const TOAST_ICONS: Record<ToastType, typeof Info> = {
    success: CheckCircle2,
    error: AlertCircle,
    info: Info,
};

interface ToastItemProps {
    toast: Toast;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast }) => {
    const dismissToast = useStore((state) => state.dismissToast);
    const Icon = TOAST_ICONS[toast.type];

    useEffect(() => {
        const timer = setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS);
        return () => clearTimeout(timer);
    }, [toast.id, dismissToast]);

    return (
        <div
            className={`pointer-events-auto flex items-start gap-3 w-full px-4 py-3 rounded-lg border shadow-lg text-sm font-medium animate-in fade-in slide-in-from-bottom-2 duration-200 ${TOAST_STYLES[toast.type]}`}
        >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1 whitespace-pre-wrap break-words">{toast.message}</p>
            <button
                onClick={() => dismissToast(toast.id)}
                className="p-0.5 rounded hover:bg-black/10 transition-colors shrink-0"
                aria-label="通知を閉じる"
            >
                <X size={16} />
            </button>
        </div>
    );
};

// アプリ全体のトースト表示スタック。layout で1度だけマウントする。
const Toaster: React.FC = () => {
    const toasts = useStore((state) => state.toasts);

    if (toasts.length === 0) {
        return null;
    }

    return (
        <div
            className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm"
            role="status"
            aria-live="polite"
        >
            {toasts.map((toast) => (
                <ToastItem key={toast.id} toast={toast} />
            ))}
        </div>
    );
};

export default Toaster;
