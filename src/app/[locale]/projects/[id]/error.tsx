'use client';

export default function ProjectDetailError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
            <h2 className="text-xl font-semibold text-zinc-900">Project page failed to load</h2>
            <p className="text-sm text-zinc-600">
                Retry this project page in a moment.
            </p>
            <button
                onClick={reset}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
            >
                Retry
            </button>
        </div>
    );
}
