import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
// Use the same blockmap implementation as the locked electron-builder version.
import { buildBlockMap } from 'app-builder-lib/out/targets/blockmap/blockmap.js';

export async function refreshWindowsMetadata(directory) {
  const names = await fs.readdir(directory);
  const installers = names.filter((name) => /^Flare-.*-Windows-x64\.exe$/.test(name));
  if (installers.length !== 1) throw new Error('Expected exactly one Windows installer');
  const installer = installers[0];
  const info = await buildBlockMap(path.join(directory, installer), 'gzip', path.join(directory, `${installer}.blockmap`));
  for (const name of names.filter((name) => /\.yml$/.test(name) && !name.startsWith('builder-'))) {
    const filename = path.join(directory, name);
    const metadata = yaml.load(await fs.readFile(filename, 'utf8'));
    if (!metadata || !Array.isArray(metadata.files)) continue;
    let changed = false;
    for (const file of metadata.files) {
      if (file.url === installer) {
        file.sha512 = info.sha512;
        file.size = info.size;
        changed = true;
      }
    }
    if (metadata.path === installer) { metadata.sha512 = info.sha512; changed = true; }
    if (changed) await fs.writeFile(filename, yaml.dump(metadata));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await refreshWindowsMetadata(path.resolve(process.argv[2] ?? 'release'));
}
