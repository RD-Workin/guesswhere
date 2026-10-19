// Rend l'icône SVG en PNG (iOS exige un PNG plein cadre, sans coins transparents).
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
const svg = readFileSync(new URL('../public/icone.svg', import.meta.url), 'utf8').replace('rx="112"', 'rx="0"');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
for (const size of [180, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await page.screenshot({ path: new URL(`../public/icone-${size}.png`, import.meta.url).pathname });
}
await browser.close();
