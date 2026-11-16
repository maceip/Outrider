// QA renderer: loads a GLB in three.js (headless Chromium) and captures views.
// usage: node shoot.mjs <glb-url-path> <out-dir> [views...]
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] || '/futuristic_neon_remote_v2.glb';
const outDir = process.argv[3] || path.join(here, 'shots');
const views = process.argv.slice(4).length ? process.argv.slice(4) : ['front', 'quarter', 'back'];
const PORT = process.env.QA_PORT || '8765';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });

for (const view of views) {
  const env = process.env.QA_ENV || '0.65';
  const url = `http://127.0.0.1:${PORT}/qa/render.html?view=${view}&env=${env}&model=${encodeURIComponent(base)}`;
  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 45000 });
  } catch (e) {
    console.log(`[${view}] render timed out`);
  }
  const err = await page.evaluate(() => window.__error || null);
  if (err) console.log(`[${view}] ${err}`);
  const out = path.join(outDir, `${view}.png`);
  await page.screenshot({ path: out });
  console.log(`[${view}] -> ${out}`);
}
await browser.close();
