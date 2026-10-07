import 'regenerator-runtime/runtime';
import fontkit, { type Font, type GlyphRun } from '@pdf-lib/fontkit';
import notoDevanagariUrl from '../assets/fonts/NotoSansDevanagari-Bold.ttf?url';
import notoSansUrl from '../assets/fonts/NotoSans-Regular.ttf?url';
import notoSansMathUrl from '../assets/fonts/NotoSansMath-Regular.ttf?url';
import {
  beginText, concatTransformationMatrix, endText, PDFHexString, PDFName, PDFOperator, PDFOperatorNames,
  popGraphicsState, pushGraphicsState, rgb, setFillingRgbColor, setFontAndSize, setGraphicsState,
  setTextMatrix, showText,
  type PDFDocument, type PDFFont, type PDFPage, type RGB,
} from 'pdf-lib';

const assets = import.meta.glob<string>([
  '/node_modules/@fontsource/balsamiq-sans/files/*.woff',
  '/node_modules/@fontsource/inter/files/inter-greek-{400,700}-{normal,italic}.woff',
  '/node_modules/katex/dist/fonts/*.ttf',
], { eager: true, query: '?url', import: 'default' });
const fontUrls = new Map(Object.entries(assets).map(([path, url]) => [path.split('/').at(-1)!, url]));
fontUrls.set('NotoSansDevanagari-Bold.ttf', notoDevanagariUrl);
fontUrls.set('NotoSans-Regular.ttf', notoSansUrl);
fontUrls.set('NotoSansMath-Regular.ttf', notoSansMathUrl);
// Font bytes may be reused, but an embedded font belongs to one PDF document.
const fontBytes = new Map<string, Promise<Uint8Array>>();
// Match the map's font-variant-ligatures: none; required Indic shaping remains enabled.
const fontFeatures = { liga: false, clig: false };
const devanagari = /[\u0900-\u097f\ua8e0-\ua8ff]/u;

interface TextStyle {
  family: string;
  bold: boolean;
  italic: boolean;
  canvasFont: string;
  size: number;
  color: RGB;
  opacity: number;
}

interface Glyph {
  text: string;
  x: number;
  baseline: number;
  width: number;
  size: number;
  style: TextStyle;
}

interface EmbeddedFont {
  font: PDFFont;
  characters: Set<number>;
  shapingFont?: Font;
  pageNames: WeakMap<PDFPage, PDFName>;
}

interface PositionedGlyph extends Glyph {
  embedded: EmbeddedFont;
}

export interface DiagramTextOptions {
  left: number;
  top: number;
  /** PDF points for one source CSS pixel. */
  scale: number;
  pageHeight: number;
}

async function loadFontBytes(name: string): Promise<Uint8Array> {
  const url = fontUrls.get(name);
  if (!url) throw new Error(`The PDF font ${name} is unavailable.`);
  let pending = fontBytes.get(url);
  if (!pending) {
    pending = fetch(url).then(async response => {
      if (!response.ok) throw new Error(`Could not load PDF font ${name}. Please try again.`);
      return new Uint8Array(await response.arrayBuffer());
    }).catch(error => { fontBytes.delete(url); throw error; });
    fontBytes.set(url, pending);
  }
  return pending;
}

function primaryFont(style: TextStyle): string {
  if (style.family.startsWith('KaTeX_')) {
    let variant = 'Regular';
    if (style.family === 'KaTeX_Math') variant = style.bold ? 'BoldItalic' : 'Italic';
    else if (style.family === 'KaTeX_Main') {
      variant = style.bold ? style.italic ? 'BoldItalic' : 'Bold' : style.italic ? 'Italic' : 'Regular';
    } else if (style.family === 'KaTeX_SansSerif') {
      variant = style.bold ? 'Bold' : style.italic ? 'Italic' : 'Regular';
    } else if ((style.family === 'KaTeX_Caligraphic' || style.family === 'KaTeX_Fraktur') && style.bold) {
      variant = 'Bold';
    }
    const name = `${style.family}-${variant}.ttf`;
    if (fontUrls.has(name)) return name;
  }
  return style.family === 'Noto Sans Devanagari'
    ? 'NotoSansDevanagari-Bold.ttf'
    : `balsamiq-sans-latin-${style.bold ? 700 : 400}-${style.italic ? 'italic' : 'normal'}.woff`;
}

function fallbackFonts(style: TextStyle): string[] {
  const weight = style.bold ? 700 : 400;
  const variant = style.italic ? 'italic' : 'normal';
  return [
    ...['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'].map(subset =>
      `balsamiq-sans-${subset}-${weight}-${variant}.woff`),
    'NotoSansDevanagari-Bold.ttf',
    // Match the CSS fallback stack before trying specialist math faces.
    'NotoSans-Regular.ttf',
    'NotoSansMath-Regular.ttf',
    `inter-greek-${weight}-${variant}.woff`,
    `KaTeX_Main-${style.bold ? style.italic ? 'BoldItalic' : 'Bold' : style.italic ? 'Italic' : 'Regular'}.ttf`,
    `KaTeX_Math-${style.bold ? 'BoldItalic' : 'Italic'}.ttf`,
    'KaTeX_AMS-Regular.ttf',
  ];
}

function visibleStyle(element: HTMLElement, source: HTMLElement, cache: Map<Element, CSSStyleDeclaration>): TextStyle | undefined {
  const view = element.ownerDocument.defaultView!;
  const computed = (node: Element) => {
    let style = cache.get(node);
    if (!style) { style = view.getComputedStyle(node); cache.set(node, style); }
    return style;
  };
  const style = computed(element);
  if (style.visibility !== 'visible') return;
  let opacity = 1;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const parentStyle = computed(parent);
    if (parentStyle.display === 'none') return;
    opacity *= Number(parentStyle.opacity);
    if (parent === source) break;
  }
  const channels = style.color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  opacity *= channels[3] ?? 1;
  if (opacity <= 0) return;
  return {
    family: style.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
    bold: Number(style.fontWeight) >= 600 || style.fontWeight === 'bold',
    italic: style.fontStyle !== 'normal',
    canvasFont: style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    size: Number.parseFloat(style.fontSize),
    color: rgb(...channels.slice(0, 3).map(value => Math.max(0, Math.min(1, value / 255))) as [number, number, number]),
    opacity,
  };
}

/** Read the rendered glyph positions rather than reflowing or reparsing labels. */
function textLeaves(element: HTMLElement): Glyph[][] {
  const owner = element.ownerDocument;
  const context = owner.createElement('canvas').getContext('2d');
  if (!context) throw new Error('This browser could not measure the PDF text.');
  context.textBaseline = 'alphabetic';
  const origin = element.getBoundingClientRect();
  const styles = new Map<Element, CSSStyleDeclaration>();
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const leaves: Glyph[][] = [];
  for (const label of element.querySelectorAll<HTMLElement>('[data-export-node] .chapter-node-label')) {
    const walker = owner.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const parent = node.parentElement;
      if (!parent || parent.closest('.katex-mathml, svg')) continue;
      const text = node.data;
      if (!text || !text.trim()) continue;
      const style = visibleStyle(parent, element, styles);
      if (!style || !Number.isFinite(style.size) || style.size <= 0) continue;
      context.font = style.canvasFont;
      const glyphs: Glyph[] = [];
      const range = owner.createRange();
      for (const { segment, index } of segmenter.segment(text)) {
        // KaTeX uses invisible markers for positioning its vertical lists.
        if (/^[\r\n\t\u200b-\u200f\ufeff]+$/u.test(segment)) continue;
        range.setStart(node, index);
        range.setEnd(node, index + segment.length);
        const box = range.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) continue;
        const metrics = context.measureText(segment);
        const ascent = metrics.fontBoundingBoxAscent;
        const descent = metrics.fontBoundingBoxDescent;
        if (!Number.isFinite(ascent) || !Number.isFinite(descent) || ascent + descent <= 0) {
          throw new Error('This browser does not support accurate PDF font measurements.');
        }
        // Range rectangles include inherited CSS transforms, including the
        // fitting scale used for a formula that is wider than its card.
        const effectiveScale = box.height / (ascent + descent);
        glyphs.push({
          text: segment,
          x: box.left - origin.left,
          baseline: box.top - origin.top + ascent * effectiveScale,
          width: box.width,
          size: style.size * effectiveScale,
          style,
        });
      }
      if (glyphs.length) leaves.push(glyphs);
    }
  }
  return leaves;
}

/** pdf-lib encodes Indic substitutions, but omits their advances and mark offsets. */
function drawShapedRun(
  page: PDFPage, first: PositionedGlyph, text: string, layout: GlyphRun,
  x: number, y: number, size: number, horizontalScale: number,
): void {
  const { font, shapingFont, pageNames } = first.embedded;
  const encoded = font.encodeText(text).asString();
  if (encoded.length !== layout.glyphs.length * 4) throw new Error('The PDF font could not shape this text.');
  let fontName = pageNames.get(page);
  if (!fontName) {
    fontName = page.node.newFontDictionary(font.name, font.ref);
    pageNames.set(page, fontName);
  }
  // Keep the logical reading order when visual glyph order changes (e.g. Hindi i-matra).
  page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
    PDFName.of('Span'), `<< /ActualText ${PDFHexString.fromText(text)} >>`,
  ]), pushGraphicsState());
  if (first.style.opacity < 1) {
    const state = page.node.newExtGState('TextOpacity', page.doc.context.obj({
      Type: 'ExtGState', ca: first.style.opacity,
    }));
    page.pushOperators(setGraphicsState(state));
  }
  const { red, green, blue } = first.style.color;
  page.pushOperators(setFillingRgbColor(red, green, blue), beginText(), setFontAndSize(fontName, size));
  const units = size / shapingFont!.unitsPerEm;
  let penX = 0;
  let penY = 0;
  for (let index = 0; index < layout.positions.length; index++) {
    const position = layout.positions[index];
    page.pushOperators(
      setTextMatrix(horizontalScale, 0, 0, 1,
        x + (penX + position.xOffset) * units * horizontalScale,
        y + (penY + position.yOffset) * units),
      showText(PDFHexString.of(encoded.slice(index * 4, index * 4 + 4))),
    );
    penX += position.xAdvance;
    penY += position.yAdvance;
  }
  page.pushOperators(endText(), popGraphicsState(), PDFOperator.of(PDFOperatorNames.EndMarkedContent));
}

function drawRun(page: PDFPage, glyphs: PositionedGlyph[], options: DiagramTextOptions): void {
  const first = glyphs[0];
  const text = glyphs.map(glyph => glyph.text).join('');
  if (!text) return;
  const last = glyphs.at(-1)!;
  const width = last.x + last.width - first.x;
  const { font, shapingFont } = first.embedded;
  const layout = shapingFont?.layout(text, fontFeatures);
  const naturalWidth = layout
    ? layout.positions.reduce((sum, position) => sum + position.xAdvance, 0) * first.size / shapingFont!.unitsPerEm
    : font.widthOfTextAtSize(text, first.size);
  // A single run is compact when font advances match the browser. Explicit
  // glyph positions preserve kerning/spacing where those advances differ.
  if (glyphs.length > 1 && Math.abs(naturalWidth - width) > 0.35) {
    for (const glyph of glyphs) drawRun(page, [glyph], options);
    return;
  }
  const x = options.left + first.x * options.scale;
  const y = options.pageHeight - options.top - first.baseline * options.scale;
  const size = first.size * options.scale;
  // Browser fallback glyphs can have different widths from the embedded
  // substitute. Keep their measured space without moving adjacent symbols.
  const horizontalScale = naturalWidth > 0 && Math.abs(naturalWidth - width) > 0.35 ? width / naturalWidth : 1;
  if (layout) {
    drawShapedRun(page, first, text, layout, x, y, size, horizontalScale);
    return;
  }
  if (horizontalScale !== 1) {
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(horizontalScale, 0, 0, 1, x, 0));
  }
  page.drawText(text, {
    x: horizontalScale === 1 ? x : 0,
    y, size, font, color: first.style.color, opacity: first.style.opacity,
  });
  if (horizontalScale !== 1) page.pushOperators(popGraphicsState());
}

/** Paint selectable vector text using the same font faces and positions as the map. */
export async function drawDiagramText(
  document: PDFDocument,
  page: PDFPage,
  element: HTMLElement,
  options: DiagramTextOptions,
): Promise<void> {
  await element.ownerDocument.fonts.ready;
  const leaves = textLeaves(element);
  document.registerFontkit(fontkit);
  const embedded = new Map<string, Promise<EmbeddedFont>>();
  const embed = (name: string) => {
    let pending = embedded.get(name);
    if (!pending) {
      pending = loadFontBytes(name).then(async bytes => {
        // Subsetting also converts WOFF input into a valid PDF font program.
        const font = await document.embedFont(bytes, { subset: true, features: fontFeatures });
        return {
          font, characters: new Set(font.getCharacterSet()), pageNames: new WeakMap(),
          shapingFont: name === 'NotoSansDevanagari-Bold.ttf' ? fontkit.create(bytes) : undefined,
        };
      });
      embedded.set(name, pending);
    }
    return pending;
  };
  const chosen = new Map<string, Promise<EmbeddedFont>>();
  const chooseFont = (glyph: Glyph) => {
    const primary = primaryFont(glyph.style);
    const key = `${primary}:${glyph.text}`;
    let pending = chosen.get(key);
    if (!pending) {
      pending = (async () => {
        const codePoints = Array.from(glyph.text, char => char.codePointAt(0)!);
        const names = new Set([primary, ...fallbackFonts(glyph.style)]);
        for (const name of names) {
          const candidate = await embed(name);
          if (codePoints.every(codePoint => candidate.characters.has(codePoint))) return candidate;
        }
        const codes = codePoints.map(value => `U+${value.toString(16).toUpperCase()}`).join(' ');
        throw new Error(`The PDF fonts cannot display "${glyph.text}" (${codes}). Use a supported symbol or a LaTeX formula.`);
      })();
      chosen.set(key, pending);
    }
    return pending;
  };

  for (const leaf of leaves) {
    let run: PositionedGlyph[] = [];
    for (const glyph of leaf) {
      const positioned = { ...glyph, embedded: await chooseFont(glyph) };
      const previous = run.at(-1);
      if (previous && (previous.embedded !== positioned.embedded
        // Fontkit detects one script per run, so separate adjacent Latin/Indic text.
        || devanagari.test(previous.text) !== devanagari.test(positioned.text)
        || Math.abs(previous.baseline - positioned.baseline) > 0.1
        || Math.abs(previous.size - positioned.size) > 0.01
        || Math.abs(previous.x + previous.width - positioned.x) > 0.5)) {
        drawRun(page, run, options);
        run = [];
      }
      run.push(positioned);
    }
    if (run.length) drawRun(page, run, options);
  }
}
