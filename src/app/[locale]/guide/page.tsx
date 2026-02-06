import { getAllDocs } from '@/lib/docs';
import Link from 'next/link';
import { Book, ChevronLeft } from 'lucide-react';
import React from 'react';

export default function GuideIndexPage() {
    const docs = getAllDocs();

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-4xl mx-auto px-4 h-16 flex items-center gap-4">
                    <Link href="/tasks" className="text-gray-500 hover:text-gray-800 transition-colors">
                        <ChevronLeft size={24} />
                    </Link>
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        <Book className="text-blue-600" />
                        ヘルプセンター
                    </h1>
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 py-8">
                <div className="grid gap-4">
                    {docs.map((doc) => (
                        <Link key={doc.slug} href={`/guide/${doc.slug}`}>
                            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group">
                                <h2 className="text-lg font-bold text-gray-800 group-hover:text-blue-600 mb-2">
                                    {doc.meta.title}
                                </h2>
                                {doc.meta.description && (
                                    <p className="text-gray-600 text-sm">
                                        {doc.meta.description}
                                    </p>
                                )}
                            </div>
                        </Link>
                    ))}

                    {docs.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                            記事がまだありません。
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
