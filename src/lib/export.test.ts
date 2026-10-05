import { describe, expect, it } from 'vitest';
import { diagramPDFSize, pdfFilename } from './pdf-layout';

const MM = 72 / 25.4;

describe('continuous roadmap PDF', () => {
  it('keeps text at the same size as a map gets longer', () => {
    const short = diagramPDFSize(1156, 1500);
    const long = diagramPDFSize(1156, 12_000);
    expect(short.width).toBeCloseTo(256 * MM);
    expect(long.width).toBeCloseTo(short.width);
    expect(long.scale).toBe(short.scale);
    expect(long.height - 24 * MM).toBeCloseTo((short.height - 24 * MM) * 8);
    expect(long.height).toBeGreaterThan(297 * MM);
    expect(long.left).toBeCloseTo(12 * MM);
  });

  it('centers a small map without enlarging it', () => {
    const size = diagramPDFSize(500, 700);
    expect(size.scale).toBe(0.75);
    expect(size.width).toBeCloseTo(256 * MM);
    expect(size.left).toBeCloseTo((size.width - 500 * size.scale) / 2);
    expect(size.height).toBeCloseTo(700 * 0.75 + 24 * MM);
  });

  it('uses PDF user units for exceptionally tall maps without shrinking text', () => {
    const normal = diagramPDFSize(1156, 1500);
    const huge = diagramPDFSize(1156, 100_000);
    expect(huge.userUnit).toBeGreaterThan(1);
    expect(huge.height).toBeCloseTo(14_400);
    expect(huge.width * huge.userUnit).toBeCloseTo(256 * MM);
    expect(huge.scale * huge.userUnit).toBeCloseTo(normal.scale);
  });

  it.each([[0, 20], [20, -1], [Infinity, 20], [20, NaN]])('rejects invalid dimensions %s by %s', (width, height) => {
    expect(() => diagramPDFSize(width, height)).toThrow('positive, finite');
  });
});

describe('PDF filenames', () => {
  it('uses the chapter title with filesystem-safe characters', () => {
    expect(pdfFilename('  Trigonometry: Complete / Mastery?  ')).toBe('trigonometry-complete-mastery.pdf');
    expect(pdfFilename('...')).toBe('roadmap.pdf');
    expect(pdfFilename('α and θ')).toBe('α-and-θ.pdf');
  });
});
