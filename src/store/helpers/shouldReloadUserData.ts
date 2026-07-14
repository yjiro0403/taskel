export type InitialDataStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Whether setUser should tear down subscriptions and re-fetch tasks/data.
 *
 * - Different user / sign-in / sign-out → reload
 * - Same uid + ready|loading → skip (profile edits, token refresh, duplicate auth events)
 * - Same uid + error|idle → reload so a failed initial fetch can retry and idle never hides loading
 */
export function shouldReloadUserData(
    existingUid: string | null | undefined,
    nextUid: string | null | undefined,
    initialDataStatus: InitialDataStatus = 'idle'
): boolean {
    if (!nextUid) {
        return Boolean(existingUid);
    }
    if (!existingUid) {
        return true;
    }
    if (existingUid !== nextUid) {
        return true;
    }

    // Same authenticated user: only re-bootstrap after failure or if bootstrap never started.
    // Do not interrupt an in-flight load (avoids race that hides loading / double-fetch).
    return initialDataStatus === 'error' || initialDataStatus === 'idle';
}
