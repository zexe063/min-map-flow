import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import { jsPDF } from 'jspdf';
import type { Chapter } from '../types';

type CapturedMap = { canvas: HTMLCanvasElement; width: number; height: number };
const MAX_CANVAS_DIMENSION = 12_000;
const MAX_CANVAS_PIXELS = 60_000_000;

function filename(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'chapter-map';
}

async function capture(element: HTMLElement): Promise<CapturedMap> {
  await document.fonts.ready;
  // Let a formula's final font metrics reach layout before reading bounds.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const bounds = element.getBoundingClientRect();
  const width = Math.ceil(Math.max(element.scrollWidth, bounds.width));
  const height = Math.ceil(Math.max(element.scrollHeight, bounds.height));
  if (width < 1 || height < 1) throw new Error('There is no map to export yet.');
  if (width > 100_000 || height > 100_000) {
    throw new Error('This map is too spread out to export. Regenerate the map and try again.');
  }
  const pixelRatio = Math.min(2, MAX_CANVAS_DIMENSION / width,
    MAX_CANVAS_DIMENSION / height, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
  const fontEmbedCSS = await getFontEmbedCSS(element, { preferredFontFormat: 'woff2' });
  const canvas = await toCanvas(element, {
    width,
    height,
    pixelRatio,
    fontEmbedCSS,
    backgroundColor: '#ffffff',
    style: {
      position: 'relative',
      left: '0',
      top: '0',
      margin: '0',
      transform: 'none',
      opacity: '1',
      visibility: 'visible',
    },
  });
  return { canvas, width, height };
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

export async function exportPng(element: HTMLElement, chapter: Chapter): Promise<void> {
  const { canvas } = await capture(element);
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('The browser could not create the image.')), 'image/png');
    });
    downloadBlob(blob, `${filename(chapter.title)}.png`);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Keep the entire image on one A4 sheet, using the orientation with the best fit. */
export function fitMapToA4(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The map must have positive, finite dimensions.');
  }
  const margin = 8;
  const portraitScale = Math.min((210 - margin * 2) / width, (297 - margin * 2) / height);
  const landscapeScale = Math.min((297 - margin * 2) / width, (210 - margin * 2) / height);
  const orientation = landscapeScale > portraitScale ? 'landscape' as const : 'portrait' as const;
  const pageWidth = orientation === 'portrait' ? 210 : 297;
  const pageHeight = orientation === 'portrait' ? 297 : 210;
  const scale = Math.max(portraitScale, landscapeScale);
  const imageWidth = width * scale;
  const imageHeight = height * scale;
  return {
    orientation, pageWidth, pageHeight,
    width: imageWidth,
    height: imageHeight,
    x: (pageWidth - imageWidth) / 2,
    y: (pageHeight - imageHeight) / 2,
  };
}

export async function exportPdf(element: HTMLElement, chapter: Chapter): Promise<void> {
  const { canvas, width, height } = await capture(element);
  try {
    const placement = fitMapToA4(width, height);
    const pdf = new jsPDF({ orientation: placement.orientation, unit: 'mm', format: 'a4', compress: true });
    pdf.setProperties({ title: chapter.title, subject: 'Chapter mind map' });
    pdf.addImage(canvas, 'PNG', placement.x, placement.y, placement.width, placement.height, undefined, 'FAST');
    await pdf.save(`${filename(chapter.title)}.pdf`, { returnPromise: true });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
