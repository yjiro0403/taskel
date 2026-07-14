import { describe, expect, it } from 'vitest';

import { shouldReloadUserData } from './shouldReloadUserData';

describe('shouldReloadUserData (profile task loading guard)', () => {
  it('skips reload when the same user is ready (profile field updates)', () => {
    expect(shouldReloadUserData('user-1', 'user-1', 'ready')).toBe(false);
  });

  it('skips reload while the same user bootstrap is in flight (no race/double fetch)', () => {
    expect(shouldReloadUserData('user-1', 'user-1', 'loading')).toBe(false);
  });

  it('retries when the same user had an initial fetch failure', () => {
    expect(shouldReloadUserData('user-1', 'user-1', 'error')).toBe(true);
  });

  it('reloads when same uid is idle (bootstrap never completed)', () => {
    expect(shouldReloadUserData('user-1', 'user-1', 'idle')).toBe(true);
  });

  it('reloads when signing in from logged-out state', () => {
    expect(shouldReloadUserData(null, 'user-1', 'idle')).toBe(true);
    expect(shouldReloadUserData(undefined, 'user-1', 'idle')).toBe(true);
  });

  it('reloads when switching accounts', () => {
    expect(shouldReloadUserData('user-1', 'user-2', 'ready')).toBe(true);
  });

  it('handles sign-out without treating null→null as a load', () => {
    expect(shouldReloadUserData(null, null, 'idle')).toBe(false);
    expect(shouldReloadUserData('user-1', null, 'ready')).toBe(true);
  });
});
