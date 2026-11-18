import {execSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const distDir = path.join(__dirname, 'dist');
const wwwDistDir = path.join(repoRoot, 'www-dist');

execSync('npm run build', {cwd: __dirname, stdio: 'inherit'});

const targetAssetsDir = path.join(wwwDistDir, 'assets');
fs.rmSync(targetAssetsDir, {recursive: true, force: true});
fs.cpSync(path.join(distDir, 'assets'), targetAssetsDir, {recursive: true});

const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
fs.writeFileSync(path.join(wwwDistDir, 'index.html'), indexHtml, 'utf8');
fs.writeFileSync(path.join(wwwDistDir, '404.html'), indexHtml, 'utf8');

// Verify deploy-pages.yml invariants (HAR SHA-256 + /__PAGES_BASE__ token)
const harPath = path.join(wwwDistDir, 'demo', 'live-capture.har');
const bundlePath = path.join(wwwDistDir, 'demo', 'live-session-bundle.json');
if (!fs.existsSync(harPath) || !fs.existsSync(bundlePath)) {
  throw new Error('Missing www-dist/demo/live-capture.har or live-session-bundle.json');
}
const bundleData = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const actualSha = crypto
  .createHash('sha256')
  .update(fs.readFileSync(harPath))
  .digest('hex');
if (bundleData.harSha256 && bundleData.harSha256 !== actualSha) {
  throw new Error(`HAR SHA-256 mismatch: expected ${bundleData.harSha256}, got ${actualSha}`);
}
if (!indexHtml.includes('/__PAGES_BASE__/assets/')) {
  throw new Error('Expected /__PAGES_BASE__/assets/ prefix in www-dist/index.html');
}
console.log('Built and synced Astryx Conduit showcase into www-dist/ cleanly.');
