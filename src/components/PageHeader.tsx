'use client';

import { Menu } from 'lucide-react';
import { useStore } from '@/store/useStore';
import Image from 'next/image';
import Link from 'next/link';

export default function PageHeader() {
    const { toggleLeftSidebar } = useStore();

    return (
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm h-16 flex items-center justify-between px-4 md:px-8">
            <div className="flex items-center gap-4">
                <button
                    onClick={toggleLeftSidebar}
                    className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Toggle Menu"
                >
                    <Menu size={24} />
                </button>

                <Link href="/tasks" className="relative h-8 w-32 block">
                    <Image
                        src="/logo.png"
                        alt="Taskel"
                        fill
                        className="object-contain object-left"
                        priority
                    />
                </Link>
            </div>
        </header>
    );
}
