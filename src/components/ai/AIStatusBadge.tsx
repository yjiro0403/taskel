'use client';

import { Sparkles, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

interface AIStatusBadgeProps {
  status: 'pending' | 'processing' | 'completed' | 'error';
  size?: 'sm' | 'md';
}

export function AIStatusBadge({ status, size = 'sm' }: AIStatusBadgeProps) {
  const isSmall = size === 'sm';

  switch (status) {
    case 'pending':
      return (
        <span className={clsx(
          'inline-flex items-center gap-1 rounded-full font-medium',
          isSmall ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
          'bg-amber-50 text-amber-700 border border-amber-200'
        )}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          {!isSmall && 'AI\u51E6\u7406\u5F85\u3061'}
        </span>
      );
    case 'processing':
      return (
        <span className={clsx(
          'inline-flex items-center gap-1 rounded-full font-medium',
          isSmall ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
          'bg-blue-50 text-blue-700 border border-blue-200'
        )}>
          <Loader2 size={isSmall ? 10 : 12} className="animate-spin" />
          {!isSmall && 'AI\u51E6\u7406\u4E2D'}
        </span>
      );
    case 'completed':
      return (
        <span className={clsx(
          'inline-flex items-center gap-1 rounded-full font-medium',
          isSmall ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
          'bg-green-50 text-green-700 border border-green-200'
        )}>
          <CheckCircle2 size={isSmall ? 10 : 12} />
          {!isSmall && 'AI\u5B8C\u4E86'}
        </span>
      );
    case 'error':
      return (
        <span className={clsx(
          'inline-flex items-center gap-1 rounded-full font-medium',
          isSmall ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
          'bg-red-50 text-red-700 border border-red-200'
        )}>
          <AlertCircle size={isSmall ? 10 : 12} />
          {!isSmall && '\u30A8\u30E9\u30FC'}
        </span>
      );
  }
}
