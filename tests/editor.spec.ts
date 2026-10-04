import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Chapter, ChapterLibrary } from '../src/types';

const STORAGE_KEY = 'chaptermap.library.v1';
const OUTLINE = String.raw`# Forces and motion
## Newton's laws
### Force and acceleration
- Newton's equation $F = ma$
- Acceleration
$$a = \frac{F}{m}$$
### Balanced forces
- Equilibrium $\sum F = 0$`;

async function storedLibrary(page: Page): Promise<ChapterLibrary | null> {
  return page.evaluate((key) => {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  }, STORAGE_KEY);
}

async function storedChapter(page: Page): Promise<Chapter | undefined> {
  const library = await storedLibrary(page);
  return library?.chapters.find((chapter) => chapter.id === library.activeId);
}

function card(page: Page, text: string): Locator {
  return page.locator('.react-flow__node').filter({ hasText: text });
}

async function generate(page: Page, outline = OUTLINE, count = 7) {
  await page.getByLabel('Roadmap text', { exact: true }).fill(outline);
  await page.getByRole('button', { name: 'Generate Roadmap', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(count);
  await expect.poll(async () => (await storedChapter(page))?.outline).toBe(outline);
  await expect.poll(async () => (await storedChapter(page))?.viewport).toBeTruthy();
}

async function dragCard(page: Page, target: Locator) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 85, box!.y + box!.height / 2 + 60, { steps: 12 });
  await page.mouse.up();
}

function pdfStream(pdf: Buffer, objectId: string) {
  const text = pdf.toString('latin1');
  const match = new RegExp(`(?:^|\\n)${objectId} 0 obj\\b([\\s\\S]*?)stream\\r?\\n`).exec(text);
  if (!match) throw new Error(`PDF object ${objectId} does not contain a stream.`);
  const length = Number(/\/Length\s+(\d+)/.exec(match[1])?.[1]);
  if (!Number.isFinite(length)) throw new Error('PDF stream has no explicit length.');
  const start = match.index + match[0].length;
  const bytes = pdf.subarray(start, start + length);
  return { dictionary: match[1], bytes: match[1].includes('/FlateDecode') ? inflateSync(bytes) : bytes };
}

/** Decode PNG row predictors in PDF image streams without an extra dependency. */
function rgbPixels(bytes: Buffer, width: number, height: number): Buffer {
  const stride = width * 3;
  if (bytes.length === stride * height) return bytes;
  expect(bytes.length).toBe((stride + 1) * height);
  const output = Buffer.alloc(stride * height);
  const paeth = (left: number, up: number, corner: number) => {
    const prediction = left + up - corner;
    const a = Math.abs(prediction - left), b = Math.abs(prediction - up), c = Math.abs(prediction - corner);
    return a <= b && a <= c ? left : b <= c ? up : corner;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = bytes[y * (stride + 1)];
    expect(filter).toBeLessThanOrEqual(4);
    for (let x = 0; x < stride; x += 1) {
      const index = y * stride + x;
      const left = x >= 3 ? output[index - 3] : 0;
      const up = y > 0 ? output[index - stride] : 0;
      const corner = y > 0 && x >= 3 ? output[index - stride - 3] : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, corner) : 0;
      output[index] = (bytes[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return output;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Roadmap text', { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(async () => (await storedChapter(page))?.viewport).toBeTruthy();
});

test('starts with only the text editor, map controls, and A4 PDF action', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Generate Roadmap', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download A4 PDF', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(1);
  await expect(page.locator('.tool-rail, .topic-inspector, .library-modal, .studio-tag, .panel-tabs')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /new chapter|bulk add|PNG|AI|undo|redo/i })).toHaveCount(0);
  const chapter = (await storedChapter(page))!;
  expect(chapter.nodes.length).toBeGreaterThan(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(chapter.nodes.length);
  await expect(page.locator('.react-flow__node .katex').first()).toBeAttached();
  await expect(page.locator('.react-flow__node .katex math').first()).toBeAttached();
});

test('generates connected cards with exact LaTeX source and the requested colors', async ({ page }) => {
  await generate(page);
  await expect(page.locator('.react-flow__edge')).toHaveCount(6);
  const branches = page.locator('.react-flow__edge-default .react-flow__edge-path');
  await expect(branches).toHaveCount(3);
  for (const path of await branches.evaluateAll(elements => elements.map(element => element.getAttribute('d') ?? ''))) {
    expect(path).toContain('C');
    expect(path).not.toMatch(/[LQHV]/);
  }
  await expect(page.locator('.react-flow__edge-straight')).toHaveCount(3);
  await expect(page.locator('.react-flow [data-roadmap-terminal]')).toHaveCount(2);
  await expect(page.locator('.export-stage [data-roadmap-terminal]')).toHaveCount(2);
  for (const length of await page.locator('[data-roadmap-terminal]').evaluateAll(elements => elements.map(element =>
    Number(element.getAttribute('y2')) - Number(element.getAttribute('y1'))))) {
    expect(length).toBe(100);
  }
  await expect(card(page, "Newton's equation").locator('.katex')).toHaveCount(1);
  await expect(card(page, 'Acceleration').filter({ has: page.locator('[data-kind="subtopic"]') }).locator('.math-formula--display .katex')).toHaveCount(1);
  await expect(page.locator('.react-flow__node .chapter-node--topic').first()).toHaveCSS('background-color', 'rgb(252, 255, 0)');
  await expect(page.locator('.react-flow__node .chapter-node--subtopic').first()).toHaveCSS('background-color', 'rgb(255, 229, 154)');
  const chapter = (await storedChapter(page))!;
  expect(chapter.title).toBe('Forces and motion');
  expect(chapter.nodes.map((node) => node.data.kind)).toEqual(['title', 'section', 'topic', 'subtopic', 'subtopic', 'topic', 'subtopic']);
  expect(chapter.nodes[4].data.label).toBe(String.raw`Acceleration
$$a = \frac{F}{m}$$`);
});

test('reports malformed text while retaining the last generated graph', async ({ page }) => {
  await generate(page);
  const before = (await storedChapter(page))!;
  await page.getByLabel('Roadmap text', { exact: true }).fill('# Broken chapter\n- An orphan point');
  await page.getByRole('button', { name: 'Generate Roadmap', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Line 2');
  await expect(page.locator('.react-flow__node')).toHaveCount(7);
  await expect(card(page, 'Balanced forces')).toBeAttached();
  await expect.poll(async () => (await storedChapter(page))?.draftOutline).toBe('# Broken chapter\n- An orphan point');
  expect((await storedChapter(page))!.nodes.map((node) => node.data)).toEqual(before.nodes.map((node) => node.data));
  expect((await storedChapter(page))!.outline).toBe(OUTLINE);
});

test('preserves an ungenerated draft during card selection, dragging, and reload', async ({ page }) => {
  await generate(page);
  const draft = String.raw`# A draft not generated yet
## Keep this exactly
### A future equation $\int_0^1 x^2\,dx$
- Including literal price \$5
`;
  const before = (await storedChapter(page))!.nodes.find((node) => node.id === 'node-3')!.position;
  await page.getByLabel('Roadmap text', { exact: true }).fill(draft);
  const target = page.locator('.react-flow__node[data-id="node-3"]');
  await target.click();
  await expect(page.getByLabel('Roadmap text', { exact: true })).toHaveValue(draft);
  await dragCard(page, target);
  await expect.poll(async () => (await storedChapter(page))?.nodes.find((node) => node.id === 'node-3')?.position).not.toEqual(before);
  await expect.poll(async () => (await storedChapter(page))?.draftOutline).toBe(draft);
  const moved = (await storedChapter(page))!.nodes.find((node) => node.id === 'node-3')!.position;
  await page.reload();
  await expect(page.getByLabel('Roadmap text', { exact: true })).toHaveValue(draft);
  await expect(page.locator('.react-flow__node')).toHaveCount(7);
  expect((await storedChapter(page))!.outline).toBe(OUTLINE);
  expect((await storedChapter(page))!.nodes.find((node) => node.id === 'node-3')!.position).toEqual(moved);
});

test('keeps other locally saved chapters intact when updating the active map', async ({ page }) => {
  const library = (await storedLibrary(page))!;
  const archived = structuredClone(library.chapters[0]);
  archived.id = 'archived-chapter-for-compatibility';
  archived.title = 'An older saved chapter';
  archived.draftOutline = '# An unfinished archived draft';
  archived.nodes[0].data.notes = String.raw`Archived notes with $E = mc^2$ stay intact.`;
  library.chapters.push(archived);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: JSON.stringify(library) });
  await page.reload();
  await generate(page);
  const saved = (await storedLibrary(page))!;
  expect(saved.chapters).toHaveLength(2);
  expect(saved.chapters.find((chapter) => chapter.id === archived.id)).toEqual(archived);
  expect(saved.activeId).toBe(library.activeId);
  await expect(page.getByRole('button', { name: /chapter library|my chapters|new chapter/i })).toHaveCount(0);
});

test('places the complete tall map, including the last card, on exactly one A4 PDF page', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const points = Array.from({ length: 35 }, (_, index) => `- ${index === 34 ? 'LAST POINT' : `Point ${index + 1}`} with a formula $x_{${index + 1}}^2$`);
  const outline = ['# A complete tall roadmap', '## Many useful ideas', '### A continuous sequence', ...points].join('\n');
  await generate(page, outline, 38);
  await expect(page.locator('[data-export-node]')).toHaveCount(38);
  const geometry = await page.evaluate(() => {
    const stage = document.querySelector('.export-stage')!.getBoundingClientRect();
    const viewport = document.querySelector('.react-flow')!.getBoundingClientRect();
    const boxes = Array.from(document.querySelectorAll('[data-export-node]')).map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.left - stage.left, y: box.top - stage.top, width: box.width, height: box.height };
    });
    const terminals = Array.from(document.querySelectorAll('.export-stage [data-roadmap-terminal]')).map((line) => {
      const box = line.getBoundingClientRect();
      return { x: box.left - stage.left, y: box.top - stage.top, width: box.width, height: box.height };
    });
    return { width: stage.width, height: stage.height, viewportHeight: viewport.height, boxes, terminals };
  });
  expect(geometry.height).toBeGreaterThan(geometry.viewportHeight);
  expect(geometry.terminals).toHaveLength(2);
  for (const box of [...geometry.boxes, ...geometry.terminals]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(geometry.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(geometry.height + 1);
  }
  await expect(page.locator('[data-export-node]').last()).toContainText('LAST POINT');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download A4 PDF', exact: true }).click();
  const download = await downloadPromise;
  const path = (await download.path())!;
  const pdf = await readFile(path);
  const text = pdf.toString('latin1');
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(text).toContain('%%EOF');
  expect((text.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  const mediaBox = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text)!;
  expect(mediaBox).not.toBeNull();
  const pageWidth = Number(mediaBox[3]), pageHeight = Number(mediaBox[4]);
  const sortedSize = [pageWidth, pageHeight].sort((a, b) => a - b);
  expect(sortedSize[0]).toBeCloseTo(595.28, 1);
  expect(sortedSize[1]).toBeCloseTo(841.89, 1);
  const contentsId = /\/Contents\s+(\d+)\s+0\s+R/.exec(text)![1];
  const commands = pdfStream(pdf, contentsId).bytes.toString('latin1');
  const placement = /([\d.]+)\s+0\s+0\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+cm/.exec(commands)!;
  expect(placement).not.toBeNull();
  const [, widthText, heightText, xText, yText] = placement;
  const width = Number(widthText), height = Number(heightText), x = Number(xText), y = Number(yText);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(y).toBeGreaterThanOrEqual(0);
  expect(x + width).toBeLessThanOrEqual(pageWidth + 0.01);
  expect(y + height).toBeLessThanOrEqual(pageHeight + 0.01);
  expect(width / height).toBeCloseTo(geometry.width / geometry.height, 3);

  const imageObjects = [...text.matchAll(/(?:^|\n)(\d+) 0 obj\s*<<((?:(?!endobj)[\s\S])*?\/Subtype\s*\/Image(?:(?!endobj)[\s\S])*?)stream\r?\n/g)];
  const rgbImage = imageObjects.find((match) => /\/ColorSpace\s*\/DeviceRGB/.test(match[2]));
  expect(rgbImage).toBeTruthy();
  const imageWidth = Number(/\/Width\s+(\d+)/.exec(rgbImage![2])![1]);
  const imageHeight = Number(/\/Height\s+(\d+)/.exec(rgbImage![2])![1]);
  expect(imageWidth / imageHeight).toBeCloseTo(geometry.width / geometry.height, 3);
  const pixels = rgbPixels(pdfStream(pdf, rgbImage![1]).bytes, imageWidth, imageHeight);
  const last = geometry.boxes.at(-1)!;
  const sampleX = Math.floor((last.x + last.width * 0.2) / geometry.width * imageWidth);
  const sampleY = Math.floor((last.y + last.height * 0.2) / geometry.height * imageHeight);
  const pixelIndex = (sampleY * imageWidth + sampleX) * 3;
  // Sample inside the final yellow card, beyond the visible map viewport.
  expect(pixels[pixelIndex]).toBeGreaterThan(220);
  expect(pixels[pixelIndex + 1]).toBeGreaterThan(170);
  expect(pixels[pixelIndex + 2]).toBeLessThan(210);
  for (const terminal of geometry.terminals) {
    let bluePixels = 0;
    const centerX = terminal.x / geometry.width * imageWidth;
    const fromY = Math.ceil(terminal.y / geometry.height * imageHeight);
    const toY = Math.floor((terminal.y + terminal.height) / geometry.height * imageHeight);
    for (let y = fromY; y < toY; y += 1) {
      for (let x = Math.floor(centerX - 3); x <= Math.ceil(centerX + 3); x += 1) {
        const index = (y * imageWidth + x) * 3;
        if (pixels[index + 2] > 130 && pixels[index + 2] > pixels[index] + 50) bluePixels += 1;
      }
    }
    expect(bluePixels).toBeGreaterThan(0);
  }
  await testInfo.attach('complete-one-page-a4.pdf', { path, contentType: 'application/pdf' });
});
