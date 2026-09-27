import { parentPort, workerData } from 'node:worker_threads';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanProject, parseFileFromDisk } from '../shared/scanner';
import { GraphBuilder } from '../shared/graph';
import { computeInsights } from '../shared/insights';
import type { ParsedFile } from '../shared/types';
import { detectSmells } from '../shared/smells';
import { changedRanges } from '../shared/conflicts';

const root: string = workerData.root;
const builder = new GraphBuilder();
parentPort!.on('message', ({ id, command, input }) => {
  try {
    let result: unknown;
    if (command === 'scan') result = scanProject(root);
    else if (command === 'initialize') {
      builder.setResolverOptions(input.options);
      result = builder.setAll(input.parsed);
    } else if (command === 'update') {
      const parsed: ParsedFile[] = [];
      const changed: string[] = [];
      const removed = new Set<string>(input.batch.removed);
      const texts: (string | null)[] = [];
      for (const rel of input.batch.changed as string[]) {
        const file = parseFileFromDisk(root, rel);
        if (!file && !fs.existsSync(path.join(root, rel))) { removed.add(rel); continue; }
        changed.push(rel);
        if (file) parsed.push(file);
        try {
          const abs = path.join(root, rel);
          const bytes = fs.statSync(abs).size <= 400_000 ? fs.readFileSync(abs) : null;
          texts.push(bytes && !bytes.includes(0) ? bytes.toString('utf8') : null);
        } catch { texts.push(null); }
      }
      result = {
        parsed, texts, changed, removed: [...removed],
        patch: builder.apply(parsed, [...removed]),
        tree: (input.tree || removed.size > 0) ? scanProject(root, { parse: false }).fileTree : undefined,
      };
    } else if (command === 'insights') result = computeInsights(input);
    else if (command === 'smells') {
      const graph = builder.getGraph();
      const reverse = new Map<string, string[]>();
      for (const edge of graph.edges) {
        const list = reverse.get(edge.target) ?? [];
        list.push(edge.source);
        reverse.set(edge.target, list);
      }
      result = detectSmells({ ...input, nodes: new Map(graph.nodes.map((n) => [n.id, n])),
        importersOf: (rel: string) => reverse.get(rel) ?? [], hasTests: graph.nodes.some((n) => n.isTest) });
    } else if (command === 'edits') {
      result = input.flatMap((file: { burstId: string; path: string; before: string | null; after: string | null; added: boolean }) => {
        const ranges = changedRanges(file.before, file.after);
        return ranges.length ? [{ burstId: file.burstId, path: file.path, ranges, added: file.added }] : [];
      });
    }
    else throw new Error(`Unknown indexing operation: ${command}`);
    parentPort!.postMessage({ id, result });
  } catch (error) { parentPort!.postMessage({ id, error: String(error) }); }
});
