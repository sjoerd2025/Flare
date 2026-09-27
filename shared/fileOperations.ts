import * as fs from 'node:fs';
import * as path from 'node:path';

/** Reject traversal and symlinks, including symlinked destination ancestors. */
export function fileOperationPath(root: string, rel: string, allowRoot = false): string {
  if (typeof rel !== 'string' || /[\\:\0]/.test(rel) || path.isAbsolute(rel)) throw new Error('Invalid path');
  const parts = rel.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p.toLowerCase() === '.git')) throw new Error('Invalid path');
  if (!rel && !allowRoot) throw new Error('Select a file or folder');
  let abs = root;
  for (const part of parts.filter(Boolean)) {
    abs = path.join(abs, part);
    if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) throw new Error('Symbolic links are not supported');
  }
  return abs;
}

function checkTree(abs: string): void {
  const stat = fs.lstatSync(abs);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not supported');
  if (stat.isDirectory()) for (const name of fs.readdirSync(abs)) checkTree(path.join(abs, name));
}

/** Preflight the whole batch before moving anything. Never merge or overwrite. */
export function transferFiles(root: string, sources: string[], target: string, move: boolean): string[] {
  const dir = fileOperationPath(root, target, true);
  if (!fs.statSync(dir).isDirectory()) throw new Error('Choose a destination folder');
  const unique = [...new Set(sources)];
  const roots = unique.filter((p) => !unique.some((parent) => p !== parent && p.startsWith(parent + '/')));
  const targets = new Set<string>();
  const pairs = roots.map((rel) => {
    const from = fileOperationPath(root, rel);
    const dest = [target, path.basename(from)].filter(Boolean).join('/');
    const to = fileOperationPath(root, dest);
    if (to === from || to.startsWith(from + path.sep)) throw new Error('Choose a different destination folder');
    if (fs.existsSync(to) || targets.has(to.toLowerCase())) throw new Error(`Already exists: ${dest}`);
    targets.add(to.toLowerCase());
    checkTree(from);
    return { from, to, dest };
  });
  for (const { from, to } of pairs) {
    if (move) fs.renameSync(from, to);
    else fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
  }
  return pairs.map((p) => p.dest);
}

export function importFile(root: string, rel: string, base64: string): void {
  const abs = fileOperationPath(root, rel);
  if (typeof base64 !== 'string' || base64.length > 4 * Math.ceil(20 * 1024 * 1024 / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error('Files must be at most 20 MB');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Files must be at most 20 MB');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes, { flag: 'wx' });
}
