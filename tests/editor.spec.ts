import { readFile } from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
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

const MM_PER_POINT = 25.4 / 72;
const PDF_MARGIN_MM = 12;
const PDF_WIDTH_MM = 256;

function tallOutline(count = 35) {
  return ['# A complete tall roadmap', '## Many useful ideas', '### A continuous sequence',
    ...Array.from({ length: count }, (_, index) => `- ${index === count - 1 ? 'LAST POINT' : `Point ${index + 1}`} with a formula $x_{${index + 1}}^2$`),
  ].join('\n');
}

async function sourceGeometry(page: Page) {
  return page.locator('.export-stage-holder .export-stage').evaluate(element => {
    const stage = element.getBoundingClientRect();
    return { width: Math.ceil(Math.max(element.scrollWidth, stage.width)), height: Math.ceil(Math.max(element.scrollHeight, stage.height)) };
  });
}

/** Read the PDF's own Unicode maps so missing labels cannot pass as vector output. */
async function inspectPDF(bytes: Buffer) {
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages();
  const text: string[] = [];
  const commands: string[] = [];
  const fontNames = new Set<string>();
  const fontSizes = new Set<number>();
  for (const page of pages) {
    const fonts = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    const unicodeMaps = new Map<string, Map<string, string>>();
    for (const [name, reference] of fonts?.entries() ?? []) {
      const font = pdf.context.lookup(reference, PDFDict);
      fontNames.add(font.get(PDFName.of('BaseFont'))?.toString() ?? '');
      if (!font.has(PDFName.of('ToUnicode'))) continue;
      const cmap = font.lookup(PDFName.of('ToUnicode'));
      if (!(cmap instanceof PDFRawStream)) throw new Error('Font has no readable Unicode map.');
      const source = Buffer.from(decodePDFRawStream(cmap).decode()).toString('latin1');
      const glyphs = new Map<string, string>();
      for (const section of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const entry of section[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
          const value = (entry[2].match(/.{4}/g) ?? []).map(code => String.fromCharCode(parseInt(code, 16))).join('');
          glyphs.set(entry[1].toUpperCase(), value);
        }
      }
      unicodeMaps.set(name.asString().slice(1), glyphs);
    }
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index, PDFRawStream))
      : contents instanceof PDFRawStream ? [contents] : [];
    expect(streams.length).toBeGreaterThan(0);
    let currentFont = '';
    for (const stream of streams) {
      const source = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
      commands.push(source);
      for (const token of source.matchAll(/\/([^\s/]+)\s+([\d.]+)\s+Tf\b|<([\da-f]+)>\s*Tj\b/gi)) {
        if (token[1]) {
          currentFont = token[1];
          fontSizes.add(Number(token[2]));
        } else {
          const glyphs = unicodeMaps.get(currentFont);
          expect(glyphs, `Font ${currentFont} must provide selectable Unicode text`).toBeDefined();
          text.push((token[3].match(/.{4}/g) ?? []).map(code => glyphs!.get(code.toUpperCase()) ?? '\uFFFD').join(''));
        }
      }
    }
  }
  return { pages, text: text.join(''), commands: commands.join('\n'), fontNames: [...fontNames], fontSizes: [...fontSizes].sort((a, b) => a - b) };
}

async function downloadPDF(page: Page, path: string, filename: string) {
  // A successful download must never depend on the browser's print workflow.
  await page.evaluate(() => { window.print = () => { throw new Error('Browser printing must not be used'); }; });
  const nextDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const download = await nextDownload;
  expect(download.suggestedFilename()).toBe(filename);
  expect(await download.failure()).toBeNull();
  await download.saveAs(path);
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.editor-layout')).toBeVisible();
  const bytes = await readFile(path);
  expect(bytes.toString('latin1')).not.toMatch(/\/Subtype\s*\/Image\b/);
  expect(bytes.toString('latin1')).toMatch(/\/FontFile[23]?\b/);
  return inspectPDF(bytes);
}

function expectSourceFitsPDF(result: Awaited<ReturnType<typeof inspectPDF>>, source: { width: number; height: number }) {
  expect(result.pages).toHaveLength(1);
  const sheet = result.pages[0].getMediaBox();
  expect(sheet.width * MM_PER_POINT).toBeCloseTo(PDF_WIDTH_MM, 2);
  const scale = Math.min(1, (PDF_WIDTH_MM - 2 * PDF_MARGIN_MM) / (source.width * 25.4 / 96));
  const expectedHeight = source.height * 25.4 / 96 * scale + 2 * PDF_MARGIN_MM;
  expect(sheet.height * MM_PER_POINT).toBeCloseTo(expectedHeight, 1);
  expect(result.text).not.toContain('\uFFFD');
  expect(result.commands).toMatch(/\bTj\b/);
  expect(result.commands).toMatch(/\bc\b/);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Roadmap text', { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(async () => (await storedChapter(page))?.viewport).toBeTruthy();
});

test('starts with only the text editor, map controls, and PDF download', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Generate Roadmap', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeVisible();
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

test('downloads a complete tall vector roadmap directly on a readable continuous sheet', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await generate(page, tallOutline(), 38);
  await expect(page.getByLabel('PDF layout', { exact: true })).toHaveCount(0);
  const source = await sourceGeometry(page);
  const path = testInfo.outputPath('complete-tall-roadmap.pdf');
  const result = await downloadPDF(page, path, 'a-complete-tall-roadmap.pdf');
  expectSourceFitsPDF(result, source);
  expect(result.pages[0].getHeight() * MM_PER_POINT).toBeGreaterThan(297);
  // Positioned glyphs may express a space as a gap instead of an encoded character.
  const compact = result.text.replace(/\s+/g, '');
  expect(compact).toContain('Acompletetallroadmap');
  expect(compact).toContain('Acontinuoussequence');
  expect(compact).toContain('LASTPOINT');
  for (let index = 1; index < 35; index += 1) expect(compact).toContain(`Point${index}withaformula`);
  expect(result.fontNames.some(name => /Balsamiq/i.test(name))).toBe(true);
  expect(result.fontNames.some(name => /KaTeX/i.test(name))).toBe(true);
  await testInfo.attach('complete-tall-roadmap.pdf', { path, contentType: 'application/pdf' });
});

test('grows the downloaded page as the map gets taller without shrinking its text', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const results: Awaited<ReturnType<typeof inspectPDF>>[] = [];
  const widths: number[] = [];
  for (const count of [35, 70]) {
    await generate(page, tallOutline(count), count + 3);
    const source = await sourceGeometry(page);
    widths.push(source.width);
    const path = testInfo.outputPath(`roadmap-${count}-points.pdf`);
    const result = await downloadPDF(page, path, 'a-complete-tall-roadmap.pdf');
    expectSourceFitsPDF(result, source);
    expect(result.text.replace(/\s+/g, '')).toContain('LASTPOINT');
    results.push(result);
  }
  expect(widths[1]).toBe(widths[0]);
  expect(results[1].pages[0].getHeight()).toBeGreaterThan(results[0].pages[0].getHeight() * 1.5);
  expect(results[1].fontSizes).toEqual(results[0].fontSizes);
});

test('downloads wrapped labels, fractions, roots, and Greek symbols as vector text', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const wrapped = 'A longer explanation of acceleration and balanced forces that wraps across several lines while retaining every word in the exported roadmap';
  const literalNotation = 'sin⁻¹(x), x⁻², 10⁻³, θ, π, aₙ, x₁, H₂O';
  const outline = String.raw`# Formulas and Greek symbols
## Mathematical notation
### Motion and geometry
- Newton's equation $F = ma$
- Acceleration
$$a = \frac{F}{m}$$
- Root $\sqrt{x^2 + y^2}$
- Greek symbols θ and π stay readable
- Literal notation ${literalNotation}
- ${wrapped}`;
  await generate(page, outline, 9);
  const source = await sourceGeometry(page);
  const path = testInfo.outputPath('formulas-and-greek-symbols.pdf');
  const result = await downloadPDF(page, path, 'formulas-and-greek-symbols.pdf');
  expectSourceFitsPDF(result, source);
  const compact = result.text.replace(/\s+/g, '');
  expect(compact).toContain(wrapped.replace(/\s+/g, ''));
  expect(compact).toContain("Newton'sequationF=ma");
  expect(compact).toContain('Greek symbols θ and π stay readable'.replace(/\s+/g, ''));
  expect(compact).toContain(literalNotation.replace(/\s+/g, ''));
  expect(result.text).toContain('Acceleration');
  expect(result.text).toContain('Root');
  expect(result.fontNames.filter(name => /KaTeX/i.test(name)).length).toBeGreaterThanOrEqual(2);
  await testInfo.attach('formulas-and-greek-symbols.pdf', { path, contentType: 'application/pdf' });
});

test('reports a failed font download and allows PDF export to be retried', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await generate(page);
  let blockedFonts = 0;
  let blockFonts = true;
  await page.route(/\.(?:woff2?|ttf|otf)(?:\?|$)/i, async route => {
    if (blockFonts && route.request().resourceType() === 'fetch') {
      blockedFonts += 1;
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/font|download|export|fetch/i);
  expect(blockedFonts).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  await expect(page.locator('.editor-layout')).toBeVisible();
  blockFonts = false;
  const path = testInfo.outputPath('retry-forces-and-motion.pdf');
  const result = await downloadPDF(page, path, 'forces-and-motion.pdf');
  expect(result.pages).toHaveLength(1);
  expect(result.text.replace(/\s+/g, '')).toContain('Forcesandmotion');
});
