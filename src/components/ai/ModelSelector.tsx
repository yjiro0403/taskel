'use client';

import React from 'react';

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
}

const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
] as const;

export const ModelSelector: React.FC<ModelSelectorProps> = ({ value, onChange }) => {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs bg-zinc-100 dark:bg-zinc-800 border-none rounded px-2 py-1 text-zinc-600 dark:text-zinc-400 focus:ring-1 focus:ring-indigo-500 outline-none w-fit"
    >
      {AVAILABLE_MODELS.map((model) => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      ))}
    </select>
  );
};
