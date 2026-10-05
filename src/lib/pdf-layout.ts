const POINTS_PER_MM = 72 / 25.4;
const ROADMAP_WIDTH = 256 * POINTS_PER_MM;
const MARGIN = 12 * POINTS_PER_MM;
const MAX_PAGE_UNITS = 14_400;

/** A continuous roadmap: width controls text size, height follows the content. */
export function diagramPDFSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The map must have positive, finite dimensions.');
  }
  const pointsPerPixel = Math.min(72 / 96, (ROADMAP_WIDTH - MARGIN * 2) / width);
  const physicalWidth = ROADMAP_WIDTH;
  const physicalHeight = height * pointsPerPixel + MARGIN * 2;
  // PDF 1.7 UserUnit preserves physical text size even beyond the 200-inch limit.
  const userUnit = Math.max(1, physicalWidth / MAX_PAGE_UNITS, physicalHeight / MAX_PAGE_UNITS);
  return {
    width: physicalWidth / userUnit,
    height: physicalHeight / userUnit,
    scale: pointsPerPixel / userUnit,
    margin: MARGIN / userUnit,
    left: (physicalWidth - width * pointsPerPixel) / 2 / userUnit,
    userUnit,
  };
}

export function pdfFilename(title: string): string {
  const name = title.normalize('NFKC').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-').replace(/^[. -]+|[. -]+$/g, '').slice(0, 100).replace(/[. -]+$/g, '');
  return `${name.toLocaleLowerCase() || 'roadmap'}.pdf`;
}
