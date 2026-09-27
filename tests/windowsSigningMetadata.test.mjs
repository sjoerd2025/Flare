import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import yaml from 'js-yaml';
import { refreshWindowsMetadata } from '../scripts/refresh-windows-update-metadata.mjs';

const temporary = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

it('rebuilds blockmaps and both update hashes from final signed bytes without changing the installer', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-signing-test-'));
  temporary.push(dir);
  const name = 'Flare-2.1.0-Windows-x64.exe';
  const bytes = crypto.randomBytes(100_000);
  await fs.writeFile(path.join(dir, name), bytes);
  await fs.writeFile(path.join(dir, `${name}.blockmap`), 'stale');
  await fs.writeFile(path.join(dir, 'latest.yml'), yaml.dump({
    version: '2.1.0', path: name, sha512: 'old',
    files: [{ url: name, sha512: 'old', size: 1 }, { url: 'portable.zip', sha512: 'keep', size: 2 }],
  }));
  await refreshWindowsMetadata(dir);
  const result = yaml.load(await fs.readFile(path.join(dir, 'latest.yml'), 'utf8'));
  const hash = crypto.createHash('sha512').update(bytes).digest('base64');
  expect(result.sha512).toBe(hash);
  expect(result.files[0]).toEqual({ url: name, sha512: hash, size: bytes.length });
  expect(result.files[1]).toEqual({ url: 'portable.zip', sha512: 'keep', size: 2 });
  expect(await fs.readFile(path.join(dir, name))).toEqual(bytes);
  const blockmap = JSON.parse(zlib.gunzipSync(await fs.readFile(path.join(dir, `${name}.blockmap`))));
  expect(blockmap.files[0].sizes.reduce((sum, size) => sum + size, 0)).toBe(bytes.length);
});

it('rejects ambiguous installer selection', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-signing-test-'));
  temporary.push(dir);
  await expect(refreshWindowsMetadata(dir)).rejects.toThrow('exactly one');
  await fs.writeFile(path.join(dir, 'Flare-1-Windows-x64.exe'), 'a');
  await fs.writeFile(path.join(dir, 'Flare-2-Windows-x64.exe'), 'b');
  await expect(refreshWindowsMetadata(dir)).rejects.toThrow('exactly one');
});
