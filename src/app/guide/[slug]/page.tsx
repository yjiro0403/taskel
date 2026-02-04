import { getDocBySlug, getAllDocs } from '@/lib/docs';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { notFound } from 'next/navigation';
import React from 'react';

// For static export support if needed later
export async function generateStaticParams() {
    const docs = getAllDocs();
    return docs.map((doc) => ({
        slug: doc.slug,
    }));
}

export default async function GuidePostPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const doc = getDocBySlug(slug);

    if (!doc) {
        notFound();
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-4xl mx-auto px-4 h-16 flex items-center gap-4">
                    <Link href="/guide" className="text-gray-500 hover:text-gray-800 flex items-center gap-1 transition-colors text-sm font-medium">
                        <ChevronLeft size={20} />
                        一覧に戻る
                    </Link>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-4 py-8">
                <article className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm">
                    <h1 className="text-3xl font-bold text-gray-900 mb-4">{doc.meta.title}</h1>
                    <div className="prose prose-blue max-w-none">
                        <ReactMarkdown>{doc.content}</ReactMarkdown>
                    </div>
                </article>
            </main>
        </div>
    );
}
