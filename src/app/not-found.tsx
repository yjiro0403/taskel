import Link from 'next/link';

export default function NotFound() {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen py-24 text-center">
            <h1 className="text-4xl font-bold mb-4">404 - Page Not Found</h1>
            <p className="mb-8 text-gray-600">お探しのページは見つかりませんでした。</p>
            <Link href="/" className="px-5 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-all">
                Back to Home
            </Link>
        </div>
    );
}
