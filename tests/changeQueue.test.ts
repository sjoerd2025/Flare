import { expect, it } from 'vitest';
import { ChangeQueue } from '../electron/services/changeQueue';
import type { WatchBatch } from '../electron/services/watcher';

const sleep = () => new Promise((resolve) => setTimeout(resolve, 5));

it('bounds batches, serializes work and keeps the latest event during a slow indexing pass', async () => {
  const batches: WatchBatch[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let active = 0;
  let peak = 0;
  const errors: unknown[] = [];
  const queue = new ChangeQueue(async (batch) => {
    peak = Math.max(peak, ++active);
    batches.push(batch);
    if (batches.length === 1) await blocked;
    active--;
  }, (error) => errors.push(error), 0, 2);
  try {
    queue.enqueue({ changed: ['a', 'b', 'c', 'd', 'e'], removed: [] });
    await sleep();
    expect(batches).toEqual([{ changed: ['a', 'b'], removed: [] }]);
    queue.enqueue({ changed: [], removed: ['c', 'a'] });
    queue.enqueue({ changed: ['c'], removed: ['d'] });
    release();
    await expect.poll(() => queue.busy).toBe(false);
    expect(peak).toBe(1);
    expect(errors).toEqual([]);
    const final = new Map<string, string>();
    for (const batch of batches) {
      expect(batch.changed.length + batch.removed.length).toBeLessThanOrEqual(2);
      batch.changed.forEach((p) => final.set(p, 'changed'));
      batch.removed.forEach((p) => final.set(p, 'removed'));
    }
    expect(Object.fromEntries(final)).toEqual({ a: 'removed', b: 'changed', c: 'changed', d: 'removed', e: 'changed' });
  } finally { release(); queue.dispose(); }
});

it('stops queued work on dispose and reports failures without blocking later batches', async () => {
  const errors: unknown[] = [];
  let count = 0;
  const queue = new ChangeQueue(async () => { count++; throw new Error('index failed'); }, (error) => errors.push(error), 0);
  queue.enqueue({ changed: ['a'], removed: [] });
  await expect.poll(() => errors.length).toBe(1);
  queue.enqueue({ changed: ['b'], removed: [] });
  await expect.poll(() => errors.length).toBe(2);
  queue.enqueue({ changed: ['c'], removed: [] });
  queue.dispose();
  await sleep();
  expect(count).toBe(2);
});
