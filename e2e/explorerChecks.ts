import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, type Page } from '@playwright/test';

/** The same workflow over Electron IPC and the browser websocket. */
export async function checkExplorer(page: Page, root: string): Promise<void> {
  await expect(page.getByTestId('filetree')).toBeVisible();
  await page.getByTestId('search-input').fill('');
  await expect(page.getByTestId('side-changed')).toHaveCount(0);
  await expect(page.getByTestId('side-inspector')).toHaveCount(0);
  const legend = page.getByTestId('legend-collapse');
  if (await legend.getAttribute('aria-expanded') === 'false') await legend.click();
  await expect(page.getByTestId('legend')).toContainText('Graph folders');
  await expect(page.getByTestId('legend')).toContainText('Group a folder into one graph card');
  await page.getByTestId('legend-fold-all').click();
  await expect(page.getByTestId('legend-src')).toContainText('Show files');
  await page.getByTestId('legend-unfold-all').click();

  await page.locator('.explorer-files input[type=file]').setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Repository notes') },
    { name: 'schema.sql', mimeType: 'text/plain', buffer: Buffer.from('SELECT 1;') },
    { name: '.env.example', mimeType: 'text/plain', buffer: Buffer.from('PORT=3000') },
  ]);
  for (const name of ['notes.txt', 'schema.sql', '.env.example']) {
    await expect(page.getByTestId(`tree-file-${name}`)).toBeVisible();
  }
  expect(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8')).toBe('SELECT 1;');
  await expect(page.getByTestId('gcard-schema.sql')).toBeVisible();

  await page.getByLabel('Filter files', { exact: true }).fill('schema');
  await expect(page.getByTestId('tree-file-schema.sql')).toBeVisible();
  await expect(page.getByTestId('tree-file-notes.txt')).toHaveCount(0);
  await page.getByLabel('Clear file filter').click();

  await page.getByTestId('tree-file-notes.txt').click();
  await expect(page.getByTestId('file-analytics')).toHaveCount(0);
  await page.getByTestId('tree-file-notes.txt').dblclick();
  await expect(page.getByTestId('file-analytics')).toBeVisible();
  await expect(page.getByTestId('editor-notes.txt')).toBeVisible();
  await page.getByTestId('details-close').click();
  await page.getByTestId('tree-file-notes.txt').click();
  await page.keyboard.press('Control+c');
  await page.getByTestId('tree-dir-src').click();
  await page.keyboard.press('Control+v');
  await expect.poll(() => fs.existsSync(path.join(root, 'src/notes.txt'))).toBe(true);
  await expect(page.getByTestId('tree-file-src/notes.txt')).toBeVisible();
  await page.getByTestId('tree-file-src/notes.txt').click();
  await page.keyboard.press('Control+x');
  fs.mkdirSync(path.join(root, 'destination'));
  await page.getByTestId('explorer-refresh').click();
  await expect(page.getByTestId('tree-dir-destination')).toBeVisible();
  await page.getByTestId('tree-dir-destination').click();
  await page.keyboard.press('Control+v');
  await expect.poll(() => fs.existsSync(path.join(root, 'destination/notes.txt'))).toBe(true);
  expect(fs.existsSync(path.join(root, 'src/notes.txt'))).toBe(false);

  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['SELECT 2;'], 'dropped.sql', { type: 'text/plain' }));
    return transfer;
  });
  await page.getByTestId('tree-dir-destination').dispatchEvent('drop', { dataTransfer: data });
  await expect(page.getByTestId('tree-file-destination/dropped.sql')).toBeVisible();
  expect(fs.readFileSync(path.join(root, 'destination/dropped.sql'), 'utf8')).toBe('SELECT 2;');
  await page.getByTestId('tab-graph').click();
  await expect(page.getByTestId('gcard-destination/dropped.sql')).toBeVisible();
  fs.unlinkSync(path.join(root, 'schema.sql'));
  await expect(page.getByTestId('gcard-schema.sql')).toHaveCount(0);
  await page.getByTestId('zoom-fit').click();
  await page.getByTestId('gcard-notes.txt').dblclick();
  await expect(page.getByTestId('file-peek')).toBeVisible();
  await expect(page.getByTestId('file-peek').getByTestId('file-analytics')).toContainText('notes.txt');
  await page.screenshot({ path: `test-results/analytics-${path.basename(root)}.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('file-peek')).toHaveCount(0);
  await page.screenshot({ path: `test-results/sidebar-${path.basename(root)}.png` });
}
