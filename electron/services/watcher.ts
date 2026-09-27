import * as fs from 'node:fs';
import * as path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Ignore } from 'ignore';
import { toPosix } from '../../shared/paths';

export interface WatchBatch {
  /** Files added or modified (project-relative posix). */
  changed: string[];
  /** Files removed. */
  removed: string[];
}

/** Debounced recursive watcher honoring the project's ignore rules. */
export class WatcherService {
  private watcher: FSWatcher | null = null;
  private changed = new Set<string>();
  private removed = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private pendingSince = 0;
  private scanning = new Set<string>();

  constructor(
    private root: string,
    private ig: Ignore,
    private onBatch: (batch: WatchBatch) => void,
    private debounceMs = 200,
  ) {}

  start(): void {
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      ignored: (absPath: string) => {
        const rel = toPosix(path.relative(this.root, absPath));
        if (rel === '' || rel === '.') return false;
        if (rel.startsWith('..')) return true;
        return this.ig.ignores(rel) || this.ig.ignores(`${rel}/`);
      },
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    });
    this.watcher
      .on('add', (p) => this.enqueue(p, 'changed'))
      .on('change', (p) => this.enqueue(p, 'changed'))
      .on('unlink', (p) => this.enqueue(p, 'removed'))
      .on('addDir', (p) => void this.enqueueNewDir(p))
      .on('error', () => {
        // transient FS errors (locked files etc.) — safe to ignore
      });
  }

  /**
   * A directory appeared: read what is already inside it, now.
   *
   * chokidar attaches a watcher to a new directory only after it has seen it,
   * and anything written in the gap is reported whenever it next reconciles —
   * measured at over five seconds for a file created in a folder that did not
   * exist a moment earlier, against ~400ms for the same file in a folder that
   * did. An agent scaffolding a new module hits that case every time. Reading
   * the directory ourselves closes the window rather than waiting it out;
   * anything chokidar does report later is deduplicated by the pending set.
   */
  private async enqueueNewDir(absPath: string, depth = 0): Promise<void> {
    if (this.closed || depth > 6 || this.scanning.has(absPath)) return;
    this.scanning.add(absPath);
    try {
      const entries = await fs.promises.readdir(absPath, { withFileTypes: true });
      let count = 0;
      for (const entry of entries) {
        if (this.closed) return;
        const child = path.join(absPath, entry.name);
        const rel = toPosix(path.relative(this.root, child));
        if (rel === '' || rel.startsWith('..')) continue;
        if (this.ig.ignores(rel) || this.ig.ignores(`${rel}/`)) continue;
        if (entry.isDirectory()) await this.enqueueNewDir(child, depth + 1);
        else if (entry.isFile()) this.enqueue(child, 'changed');
        if (++count % 128 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } catch { /* Directory may vanish during a checkout. */ }
    finally { this.scanning.delete(absPath); }
  }

  private enqueue(absPath: string, kind: 'changed' | 'removed'): void {
    if (this.closed) return;
    const rel = toPosix(path.relative(this.root, absPath));
    if (rel === '' || rel.startsWith('..')) return;
    if (kind === 'changed') {
      this.changed.add(rel);
      this.removed.delete(rel);
    } else {
      this.removed.add(rel);
      this.changed.delete(rel);
    }
    if (!this.pendingSince) this.pendingSince = Date.now();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), Math.min(this.debounceMs, Math.max(0, 1000 - (Date.now() - this.pendingSince))));
  }

  private flush(): void {
    this.timer = null;
    this.pendingSince = 0;
    if (this.changed.size === 0 && this.removed.size === 0) return;
    const batch: WatchBatch = { changed: [...this.changed], removed: [...this.removed] };
    this.changed.clear();
    this.removed.clear();
    this.onBatch(batch);
  }

  async dispose(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
    this.watcher = null;
  }
}
