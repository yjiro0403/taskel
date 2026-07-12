'use client';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html>
            <body>
                <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
                    <h2 className="text-2xl font-semibold text-zinc-900">Unexpected application error</h2>
                    <p className="text-sm text-zinc-600">
                        Please reload this screen or try again in a moment.
                    </p>
                    <button
                        onClick={reset}
                        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
                    >
                        Reload
                    </button>
                </div>
            </body>
        </html>
    );
}
