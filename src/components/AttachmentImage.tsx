'use client';

import { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';

import type { Attachment } from '@/types';
import { getAttachmentSignedUrl } from '@/lib/storage';

interface AttachmentImageProps {
    attachment: Attachment;
    className?: string;
}

// private 化した attachments バケットでは公開URL（Attachment.url）が 404 になるため、
// 描画時に storage_path（= Attachment.path）から署名付きURLを都度生成して表示する共通コンポーネント。
// ローディング中はスピナー、生成失敗（path欠落・RLS拒否・失効等）はフォールバックアイコンを出す。
export function AttachmentImage({ attachment, className }: AttachmentImageProps) {
    const [url, setUrl] = useState<string | null>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

    useEffect(() => {
        let cancelled = false;
        setStatus('loading');
        setUrl(null);

        // path が無い（旧データ・不整合）場合は署名URLを作れないため error 表示にフォールバック。
        if (!attachment.path) {
            setStatus('error');
            return;
        }

        getAttachmentSignedUrl(attachment.path)
            .then((signed) => {
                if (cancelled) return;
                if (signed) {
                    setUrl(signed);
                    setStatus('ready');
                } else {
                    setStatus('error');
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setStatus('error');
                }
            });

        return () => {
            cancelled = true;
        };
    }, [attachment.path]);

    if (status === 'loading') {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            </div>
        );
    }

    if (status === 'error' || !url) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-50 text-gray-400" title={attachment.name}>
                <ImageOff size={16} />
            </div>
        );
    }

    return <img src={url} alt={attachment.name} className={className} />;
}
