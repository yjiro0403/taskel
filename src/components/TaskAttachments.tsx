'use client';

import type { Attachment } from '@/types';

import { X } from 'lucide-react';

interface TaskAttachmentsProps {
    attachments: Attachment[];
    isUploading: boolean;
    handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
    handleRemoveAttachment: (attachmentId: string) => Promise<void>;
}

export function TaskAttachments({
    attachments,
    isUploading,
    handleFileSelect,
    handleRemoveAttachment,
}: TaskAttachmentsProps) {
    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Attachments</label>
            <div className="flex flex-wrap gap-2 mb-2">
                {attachments.map((att) => (
                    <div key={att.id} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-gray-200">
                        <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                        <button
                            type="button"
                            onClick={() => void handleRemoveAttachment(att.id)}
                            className="absolute top-1 right-1 bg-black/50 text-white p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <X size={12} />
                        </button>
                    </div>
                ))}
                {isUploading && (
                    <div className="w-20 h-20 flex items-center justify-center bg-gray-50 rounded-lg border border-gray-200">
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                )}
                <label className="w-20 h-20 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 cursor-pointer transition-colors">
                    <span className="text-2xl text-gray-400">+</span>
                    <input
                        type="file"
                        multiple
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void handleFileSelect(e)}
                        disabled={isUploading}
                    />
                </label>
            </div>
            <p className="text-xs text-gray-400">Supported images (Max 5MB). Auto-compressed.</p>
        </div>
    );
}
