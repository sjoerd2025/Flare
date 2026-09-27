import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ProjectIndexer } from '../electron/services/projectIndexer';
import { GraphBuilder } from '../shared/graph';
import { scanProject } from '../shared/scanner';
import { computeInsights } from '../shared/insights';

let root: string;
let workerDir: string;
let indexer: ProjectIndexer;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'flare-index-repo-'));
  workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flare-index-worker-'));
  const worker = path.join(workerDir, 'index-worker.cjs');
  await build({ entryPoints: ['electron/index-worker.ts'], outfile: worker, bundle: true, platform: 'node', format: 'cjs' });
  indexer = new ProjectIndexer(root, worker);
});
afterAll(async () => {
  await indexer?.dispose();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(workerDir, { recursive: true, force: true });
});

it('indexes a bulk checkout off-thread and produces the same graph as a fresh scan', async () => {
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  const paths = Array.from({ length: 600 }, (_, i) => `file-${i}.ts`);
  for (const [i, rel] of paths.entries()) fs.writeFileSync(path.join(root, rel), `import "./file-${(i + 1) % paths.length}";\nexport const value${i} = 1;\n`);
  git('add', '.'); git('commit', '-qm', 'base');
  git('checkout', '-qb', 'updated');
  for (const [i, rel] of paths.entries()) fs.writeFileSync(path.join(root, rel), `import "./file-${(i + 2) % paths.length}";\nexport function value${i}(x: number) { return x ? 2 : 3; }\n`);
  fs.unlinkSync(path.join(root, paths[0]));
  fs.writeFileSync(path.join(root, 'schema.sql'), 'SELECT 1;');
  git('add', '-A'); git('commit', '-qm', 'bulk update');
  git('checkout', '-q', 'main');

  const initial = await indexer.scan();
  const graph = await indexer.initialize(initial.parsed, {});
  const mirror = new GraphBuilder();
  mirror.adoptAll(initial.parsed, graph);
  git('checkout', '-q', 'updated');
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 1);
  const result = await indexer.update({ changed: paths.slice(1).concat('schema.sql'), removed: [paths[0]] }, true);
  clearInterval(timer);
  expect(ticks, 'host event loop remains available while indexing').toBeGreaterThan(0);
  mirror.adoptPatch(result.parsed, result.removed, result.patch);
  const fresh = new GraphBuilder().setAll(scanProject(root).parsed);
  expect(mirror.getGraph().nodes.sort((a, b) => a.id.localeCompare(b.id))).toEqual(fresh.nodes.sort((a, b) => a.id.localeCompare(b.id)));
  const edgeOrder = (a: { source: string; target: string }, b: { source: string; target: string }) => `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`);
  expect(fresh.edges.length).toBeGreaterThan(0);
  expect(mirror.getGraph().edges.sort(edgeOrder)).toEqual(fresh.edges.sort(edgeOrder));
  expect(result.tree?.children?.some((n) => n.path === 'schema.sql')).toBe(true);

  fs.writeFileSync(path.join(root, paths[1]), 'export const replaced = 42;');
  const edit = await indexer.update({ changed: [paths[1]], removed: [] }, false);
  expect(edit.tree, 'content-only saves do not rescan the tree').toBeUndefined();
  expect(edit.texts).toEqual(['export const replaced = 42;']);
  fs.unlinkSync(path.join(root, paths[1]));
  const vanished = await indexer.update({ changed: [paths[1]], removed: [] }, false);
  expect(vanished.removed).toContain(paths[1]);
  expect(vanished.patch.removedNodeIds).toContain(paths[1]);
}, 30_000);

it('computes metrics and change ranges in the worker', async () => {
  const scan = await indexer.scan();
  const graph = await indexer.initialize(scan.parsed, {});
  const input = { nodes: graph.nodes, edges: graph.edges, churn: {}, coverage: {}, changedAt: {}, changedBy: {}, review: null, snapshots: [] };
  const expected = computeInsights(input);
  const actual = await indexer.insights(input);
  expect(actual.files).toEqual(expected.files);
  expect(await indexer.edits([{ burstId: 'b', path: 'schema.sql', before: 'SELECT 1;', after: 'SELECT 2;', added: false }]))
    .toEqual([{ burstId: 'b', path: 'schema.sql', ranges: [[1, 1]], added: false }]);
});
