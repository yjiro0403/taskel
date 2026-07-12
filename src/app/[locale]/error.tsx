'use client';

export default function LocaleError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
            <h2 className="text-2xl font-semibold text-zinc-900">Something went wrong</h2>
            <p className="text-sm text-zinc-600">
                We could not load this page. Please try again.
            </p>
            <button
                onClick={reset}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
            >
                Try again
            </button>
        </div>
    );
}
