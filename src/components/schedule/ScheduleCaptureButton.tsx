'use client';

import { useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { Link } from '@/i18n/routing';

import { currentGoogleAccessToken, fetchScheduleSettings, submitIntake } from '@/lib/schedule/apiClient';
import { removeLocalCapture, saveLocalCapture } from '@/lib/schedule/localInbox';
import { compressImage } from '@/lib/storage';
import type { ScheduleIntakeView, ScheduleSettings } from '@/lib/schedule/types';
import { useStore } from '@/store/useStore';
import { IntakeEditor } from '@/components/schedule/ScheduleInbox';

const FALLBACK_SETTINGS: ScheduleSettings = {
    autoRegister: false,
    retentionDays: 30,
    calendarId: 'primary',
    defaultDurationMinutes: null,
};

export function ScheduleCaptureButton() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="fixed bottom-24 right-8 bg-white text-blue-700 border border-blue-200 p-4 rounded-full shadow-lg hover:bg-blue-50 z-50"
                aria-label="画像や文章から予定を登録"
            >
                <ImagePlus size={24} />
            </button>
            {open && <ScheduleCaptureModal onClose={() => setOpen(false)} />}
        </>
    );
}

function ScheduleCaptureModal({ onClose }: { onClose: () => void }) {
    const user = useStore((state) => state.user);
    const [text, setText] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [phase, setPhase] = useState<'edit' | 'saving' | 'done'>('edit');
    const [message, setMessage] = useState<string | null>(null);
    const [intake, setIntake] = useState<ScheduleIntakeView | null>(null);
    const [settings, setSettings] = useState<ScheduleSettings>(FALLBACK_SETTINGS);

    const chooseFile = (next: File | null) => {
        setFile(next);
        setPreview((current) => {
            if (current) URL.revokeObjectURL(current);
            return next ? URL.createObjectURL(next) : null;
        });
    };

    const submit = async () => {
        if (!text.trim() && !file) {
            setMessage('文章または画像を入れてください。');
            return;
        }
        setPhase('saving');
        setMessage('受け取りました。この端末に保存してから解析します。');
        const id = crypto.randomUUID();
        let uploadBlob: Blob | null = file;
        let mime = file?.type || '';
        let name = file?.name || 'image';
        if (file && file.type.startsWith('image/')) {
            try {
                uploadBlob = await compressImage(file);
                mime = 'image/webp';
                name = 'capture.webp';
            } catch {
                uploadBlob = file;
            }
        }
        try {
            await saveLocalCapture({
                id,
                createdAt: Date.now(),
                kind: file ? 'image' : 'text',
                shared: false,
                blob: uploadBlob ?? undefined,
                text: text.trim() || undefined,
                name,
                mime: mime || 'text/plain',
                status: 'local',
            });
        } catch {
            setMessage('端末への保存に失敗しました。通信できる状態でそのまま送信します。');
        }

        const form = new FormData();
        form.set('source', file ? 'image_upload' : 'text');
        if (text.trim()) form.set('text', text.trim());
        if (uploadBlob) form.set('image', new File([uploadBlob], name, { type: mime || 'image/webp' }));
        try {
            const token = user ? await currentGoogleAccessToken(user.uid) : null;
            const result = await submitIntake(form, token);
            await removeLocalCapture(id).catch(() => undefined);
            const remoteSettings = await fetchScheduleSettings().catch(() => null);
            if (remoteSettings) setSettings(remoteSettings.settings);
            setIntake(result.intake);
            setPhase('done');
            setMessage(result.reused ? '同じ内容はすでに受信箱にあります。' : null);
        } catch (error) {
            setPhase('edit');
            setMessage(error instanceof Error
                ? '送信できませんでした。受信箱を開くと、この端末に残した内容から再開できます。'
                : '送信できませんでした。');
        }
    };

    return (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">予定を取り込む</h2>
                    <button type="button" onClick={onClose} className="p-2 text-gray-500" aria-label="閉じる"><X size={18} /></button>
                </div>
                <p className="text-sm text-gray-500">文章または画像から、TaskelのタスクとGoogleカレンダーの予定を作ります。曖昧な日時は自動では登録しません。</p>
                {phase !== 'done' && (
                    <>
                        <label className="block text-sm text-gray-600">文章
                            <textarea
                                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 min-h-24"
                                placeholder="10月2日 15:00-16:00 企画会議"
                                value={text}
                                onChange={(event) => setText(event.target.value)}
                            />
                        </label>
                        <label className="block text-sm text-gray-600">画像
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                className="mt-1 block w-full text-sm"
                                onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
                            />
                        </label>
                        {preview && <img src={preview} alt="選択した画像" className="max-h-48 rounded-lg object-contain" />}
                        <button
                            type="button"
                            className="w-full bg-blue-600 text-white rounded-lg py-2.5 disabled:opacity-60"
                            disabled={phase === 'saving'}
                            onClick={submit}
                        >
                            {phase === 'saving' ? '解析しています…' : '取り込む'}
                        </button>
                    </>
                )}
                {message && <p className="text-sm text-gray-700">{message}</p>}
                {phase === 'done' && intake && (
                    <IntakeEditor
                        intake={intake}
                        settings={settings}
                        onChange={setIntake}
                        onRemoved={() => {
                            setIntake(null);
                            setPhase('edit');
                        }}
                    />
                )}
                <Link href="/intake" className="block text-sm text-blue-700" onClick={onClose}>受信箱を開く</Link>
            </div>
        </div>
    );
}
