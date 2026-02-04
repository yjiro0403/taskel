import React from 'react';
import fs from 'fs';
import path from 'path';
import ReactMarkdown from 'react-markdown';

export default function TermsPage() {
    const filePath = path.join(process.cwd(), 'docs', 'TermsOfService.md');
    const content = fs.readFileSync(filePath, 'utf8');

    return (
        <div className="max-w-3xl mx-auto px-4 py-8">
            <div className="article bg-white p-8 rounded-xl border border-gray-200 shadow-sm">
                <div className="prose prose-blue max-w-none">
                    <ReactMarkdown>{content}</ReactMarkdown>
                </div>
            </div>
        </div>
    );
}
