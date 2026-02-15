'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useStore } from '@/store/useStore';

export function useKeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const openAddTaskModal = useStore((s) => s.openAddTaskModal);
  const closeAddTaskModal = useStore((s) => s.closeAddTaskModal);
  const isAddTaskModalOpen = useStore((s) => s.isAddTaskModalOpen);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip when modifier keys are held (don't interfere with browser shortcuts)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Skip when focus is on an input element
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      // Extract locale prefix from current pathname (e.g. "/en" or "/ja")
      const localeMatch = pathname.match(/^\/(en|ja)/);
      const localePrefix = localeMatch ? localeMatch[0] : '';

      switch (e.key.toLowerCase()) {
        case 'd':
          router.push(`${localePrefix}/tasks`);
          break;
        case 'w':
          router.push(`${localePrefix}/weekly`);
          break;
        case 'm':
          router.push(`${localePrefix}/monthly`);
          break;
        case 'y':
          router.push(`${localePrefix}/yearly`);
          break;
        case 'p':
          router.push(`${localePrefix}/planning`);
          break;
        case 'a':
          router.push(`${localePrefix}/analytics`);
          break;
        case 'n':
          e.preventDefault();
          openAddTaskModal();
          break;
        case 'escape':
          if (isAddTaskModalOpen) {
            closeAddTaskModal();
          }
          break;
        default:
          return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router, pathname, openAddTaskModal, closeAddTaskModal, isAddTaskModalOpen]);
}
