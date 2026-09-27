import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import type { CodeGraph, FileTreeNode, GraphPatch, ParsedFile } from '../../shared/types';
import type { ScanResult } from '../../shared/scanner';
import type { ResolverOptions } from '../../shared/resolver';
import type { Insights, InsightsInput } from '../../shared/insights';
import type { WatchBatch } from './watcher';
import type { FileChange, Smell } from '../../shared/smells';
import type { BurstEdit } from '../../shared/conflicts';

export interface IndexedBatch {
  changed: string[];
  removed: string[];
  parsed: ParsedFile[];
  texts: (string | null)[];
  patch: GraphPatch;
  tree?: FileTreeNode;
}

/** Parsing, disk traversal and graph construction never execute on the UI host. */
export class ProjectIndexer {
  private worker: Worker;
  private nextId = 0;
  private failed: Error | null = null;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();

  constructor(root: string, workerPath = path.join(__dirname, 'index-worker.cjs')) {
    this.worker = new Worker(workerPath, { workerData: { root } });
    this.worker.on('message', ({ id, result, error }) => {
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      if (error) request.reject(new Error(error)); else request.resolve(result);
    });
    const fail = (error: Error) => {
      this.failed = error;
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
    this.worker.on('error', fail);
    this.worker.on('exit', (code) => fail(new Error(`Project indexer stopped (${code})`)));
  }

  private request<T>(command: string, input?: unknown): Promise<T> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ id, command, input }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  scan(): Promise<ScanResult> { return this.request('scan'); }
  initialize(parsed: ParsedFile[], options: ResolverOptions): Promise<CodeGraph> {
    return this.request('initialize', { parsed, options });
  }
  update(batch: WatchBatch, tree: boolean): Promise<IndexedBatch> {
    return this.request('update', { batch, tree });
  }
  insights(input: InsightsInput): Promise<Insights> { return this.request('insights', input); }
  smells(files: FileChange[], degreeDelta: { path: string; before: number; after: number }[]): Promise<Smell[]> {
    return this.request('smells', { files, degreeDelta });
  }
  edits(input: { burstId: string; path: string; before: string | null; after: string | null; added: boolean }[]): Promise<BurstEdit[]> {
    return this.request('edits', input);
  }
  async dispose(): Promise<void> { await this.worker.terminate(); }
}
