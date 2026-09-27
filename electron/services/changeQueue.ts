import type { WatchBatch } from './watcher';

/** One consumer, bounded backlog, last filesystem event wins for each path. */
export class ChangeQueue {
  private pending = new Map<string, 'changed' | 'removed'>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private closed = false;

  constructor(
    private consume: (batch: WatchBatch) => Promise<void>,
    private onError: (error: unknown) => void,
    private delay = 150,
    private maxBatch = 256,
  ) {}

  get busy(): boolean { return this.running || this.pending.size > 0; }

  enqueue(batch: WatchBatch): void {
    if (this.closed) return;
    for (const rel of batch.changed) this.pending.set(rel, 'changed');
    for (const rel of batch.removed) this.pending.set(rel, 'removed');
    this.schedule();
  }

  private schedule(): void {
    // Do not restart the timer: sustained writes must still make progress.
    if (this.closed || this.running || this.timer || !this.pending.size) return;
    this.timer = setTimeout(() => { this.timer = null; void this.drain(); }, this.delay);
  }

  private async drain(): Promise<void> {
    if (this.closed) return;
    const batch: WatchBatch = { changed: [], removed: [] };
    for (const [rel, kind] of this.pending) {
      batch[kind].push(rel);
      this.pending.delete(rel);
      if (batch.changed.length + batch.removed.length >= this.maxBatch) break;
    }
    this.running = true;
    try { await this.consume(batch); }
    catch (error) { this.onError(error); }
    finally { this.running = false; this.schedule(); }
  }

  dispose(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}
