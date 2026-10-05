import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:5173/');
  await expect(page.getByLabel('Roadmap text', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate Roadmap', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeVisible();
  await page.locator('.react-flow__node').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/editor-desktop.png', fullPage: true });
  const desktop = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    topicColor: getComputedStyle(document.querySelector('.react-flow__node .chapter-node--topic')).backgroundColor,
    subtopicColor: getComputedStyle(document.querySelector('.react-flow__node .chapter-node--subtopic')).backgroundColor,
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/editor-mobile.png', fullPage: true });
  await expect(page.getByLabel('Roadmap text', { exact: true })).toBeVisible();
  const mobile = await page.evaluate(() => ({ horizontalOverflow: document.documentElement.scrollWidth > innerWidth }));
  console.log(JSON.stringify({ errors, desktop, mobile, nodes: await page.locator('.react-flow__node').count(), formulas: await page.locator('.react-flow__node .katex').count(), viewport: await page.locator('.react-flow__viewport').getAttribute('style') }));
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
