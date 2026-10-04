import { describe, expect, it } from 'vitest';
import { fitMapToA4 } from './export';

describe('single-page A4 export fit', () => {
  it.each([
    [800, 12_000, 'portrait'],
    [12_000, 800, 'landscape'],
    [1_000, 1_000, 'portrait'],
    [640, 900, 'portrait'],
    [900, 640, 'landscape'],
  ] as const)('fits a %s × %s map without cropping or distortion', (width, height, orientation) => {
    const layout = fitMapToA4(width, height);
    expect(layout.orientation).toBe(orientation);
    expect([layout.pageWidth, layout.pageHeight].sort((a, b) => a - b)).toEqual([210, 297]);
    expect(layout.x).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(layout.y).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(layout.x + layout.width).toBeLessThanOrEqual(layout.pageWidth - 8 + 1e-9);
    expect(layout.y + layout.height).toBeLessThanOrEqual(layout.pageHeight - 8 + 1e-9);
    expect(layout.width / layout.height).toBeCloseTo(width / height);
    expect(layout.x * 2 + layout.width).toBeCloseTo(layout.pageWidth);
    expect(layout.y * 2 + layout.height).toBeCloseTo(layout.pageHeight);
  });

  it('rejects dimensions that cannot be represented as a printable image', () => {
    expect(() => fitMapToA4(0, 200)).toThrow('positive, finite');
    expect(() => fitMapToA4(200, -10)).toThrow('positive, finite');
    expect(() => fitMapToA4(Infinity, 200)).toThrow('positive, finite');
    expect(() => fitMapToA4(200, NaN)).toThrow('positive, finite');
  });
});
