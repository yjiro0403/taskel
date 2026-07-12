import { describe, expect, it } from 'vitest';

import { createVirtualRoutineTaskId } from './virtualTask';

describe('createVirtualRoutineTaskId', () => {
  it('returns a deterministic uuid v5-style id for the same inputs', () => {
    const first = createVirtualRoutineTaskId('routine-1', '2026-04-11');
    const second = createVirtualRoutineTaskId('routine-1', '2026-04-11');

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('changes when routine id or date changes', () => {
    const base = createVirtualRoutineTaskId('routine-1', '2026-04-11');

    expect(createVirtualRoutineTaskId('routine-2', '2026-04-11')).not.toBe(base);
    expect(createVirtualRoutineTaskId('routine-1', '2026-04-12')).not.toBe(base);
  });
});
