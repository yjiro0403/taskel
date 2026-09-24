'use client';

import clsx from 'clsx';

interface SettingsToggleProps {
    checked: boolean;
    disabled?: boolean;
    label: string;
    hint: string;
    ariaLabel: string;
    onToggle: () => void;
}

export default function SettingsToggle({
    checked,
    disabled,
    label,
    hint,
    ariaLabel,
    onToggle,
}: SettingsToggleProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={onToggle}
            className="flex items-center justify-between w-full gap-4 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed text-left cursor-pointer"
        >
            <div>
                <p className="font-medium text-gray-900">{label}</p>
                <p className="text-sm text-gray-500 mt-1">{hint}</p>
            </div>
            <div
                className={clsx(
                    'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                    checked ? 'bg-blue-600' : 'bg-gray-300'
                )}
            >
                <div
                    className={clsx(
                        'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                        checked ? 'translate-x-[22px]' : 'translate-x-0.5'
                    )}
                />
            </div>
        </button>
    );
}
