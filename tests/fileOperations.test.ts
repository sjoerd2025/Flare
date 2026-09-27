import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fileOperationPath, importFile, transferFiles } from '../shared/fileOperations';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'flare-files-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'dest'));
  fs.writeFileSync(path.join(root, 'src', 'schema.sql'), 'SELECT 1;');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('copies folders once when both a folder and its child are selected, then moves them', () => {
  expect(transferFiles(root, ['src', 'src/schema.sql'], 'dest', false)).toEqual(['dest/src']);
  expect(fs.readFileSync(path.join(root, 'dest/src/schema.sql'), 'utf8')).toBe('SELECT 1;');
  expect(transferFiles(root, ['dest/src/schema.sql'], '', true)).toEqual(['schema.sql']);
  expect(fs.existsSync(path.join(root, 'dest/src/schema.sql'))).toBe(false);
});
it('preflights collisions and prevents recursive copies', () => {
  expect(() => transferFiles(root, ['src'], 'src', false)).toThrow();
  fs.writeFileSync(path.join(root, 'dest/schema.sql'), 'keep');
  expect(() => transferFiles(root, ['src', 'src/schema.sql', 'dest/schema.sql'], '', true)).toThrow();
  expect(fs.existsSync(path.join(root, 'src/schema.sql'))).toBe(true);
  expect(() => transferFiles(root, ['src/schema.sql'], 'dest', false)).toThrow('Already exists');
});
it('imports binary bytes and never overwrites an existing file', () => {
  const bytes = Buffer.from([0, 255, 12, 13]);
  importFile(root, 'images/file.bin', bytes.toString('base64'));
  expect(fs.readFileSync(path.join(root, 'images/file.bin'))).toEqual(bytes);
  expect(() => importFile(root, 'images/file.bin', 'YQ==')).toThrow();
  expect(fs.readFileSync(path.join(root, 'images/file.bin'))).toEqual(bytes);
});
it('rejects traversal, absolute paths, repository internals and root operations', () => {
  for (const rel of ['../outside', '/tmp/a', 'C:/a', 'a/../../b', '.git/config', 'a\\b', '']) {
    expect(() => fileOperationPath(root, rel)).toThrow();
  }
});
it('rejects junction destinations outside the repository', () => {
  fs.symlinkSync(os.tmpdir(), path.join(root, 'link'), 'junction');
  expect(() => importFile(root, 'link/escape.txt', 'YQ==')).toThrow('Symbolic');
});
