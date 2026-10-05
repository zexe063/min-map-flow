import {
  clip, concatTransformationMatrix, endPath, LineCapStyle, PDFPage,
  popGraphicsState, pushGraphicsState, rectangle, rgb,
} from 'pdf-lib';

export interface DrawingOptions { left: number; top: number; scale: number; pageHeight: number }

function color(value: string) {
  if (value === 'none' || value === 'transparent') return undefined;
  const values = value.match(/[\d.]+/g)?.map(Number);
  if (!values || values.length < 3 || (values.length > 3 && values[3] === 0)) return undefined;
  return rgb(values[0] / 255, values[1] / 255, values[2] / 255);
}

function clipBox(page: PDFPage, box: DOMRect, origin: DOMRect, options: DrawingOptions) {
  const { left, top, scale, pageHeight } = options;
  page.pushOperators(rectangle(left + (box.left - origin.left) * scale,
    pageHeight - top - (box.bottom - origin.top) * scale, box.width * scale, box.height * scale), clip(), endPath());
}

/** Paint SVG geometry using its actual screen matrix, including KaTeX stretchies. */
function drawSVG(page: PDFPage, svg: SVGSVGElement, origin: DOMRect, options: DrawingOptions) {
  for (const shape of svg.querySelectorAll<SVGGraphicsElement>('path, line, rect')) {
    const style = getComputedStyle(shape);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const matrix = shape.getScreenCTM();
    if (!matrix) continue;
    let path = shape.getAttribute('d') ?? '';
    if (shape instanceof SVGLineElement) {
      path = `M ${shape.x1.baseVal.value} ${shape.y1.baseVal.value} L ${shape.x2.baseVal.value} ${shape.y2.baseVal.value}`;
    } else if (shape instanceof SVGRectElement) {
      const x = shape.x.baseVal.value, y = shape.y.baseVal.value;
      const w = shape.width.baseVal.value, h = shape.height.baseVal.value;
      path = `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
    }
    if (!path) continue;
    page.pushOperators(pushGraphicsState());
    // KaTeX deliberately uses very long SVG paths and clips them with HTML spans.
    for (let ancestor: Element | null = shape.parentElement; ancestor && ancestor !== svg.parentElement?.closest('.export-stage'); ancestor = ancestor.parentElement) {
      const ancestorStyle = getComputedStyle(ancestor);
      if (['hidden', 'clip'].includes(ancestorStyle.overflowX) || ['hidden', 'clip'].includes(ancestorStyle.overflowY)) {
        clipBox(page, ancestor.getBoundingClientRect(), origin, options);
      }
      if (ancestor.classList.contains('export-stage')) break;
    }
    const { scale, left, top, pageHeight } = options;
    const dash = style.strokeDasharray === 'none' ? [] : style.strokeDasharray.split(/[ ,]+/).map(Number.parseFloat);
    // drawSvgPath flips SVG's downward Y axis; this outer matrix accounts for it.
    page.pushOperators(concatTransformationMatrix(scale * matrix.a, -scale * matrix.b,
      -scale * matrix.c, scale * matrix.d,
      left + (matrix.e - origin.left) * scale, pageHeight - top - (matrix.f - origin.top) * scale));
    page.drawSvgPath(path, {
      x: 0, y: 0, scale: 1,
      color: color(style.fill), borderColor: color(style.stroke),
      borderWidth: color(style.stroke) ? Number.parseFloat(style.strokeWidth) || 0 : 0,
      borderDashArray: dash.some(value => value > 0) ? dash : [],
      borderLineCap: style.strokeLinecap === 'round' ? LineCapStyle.Round : LineCapStyle.Butt,
      opacity: Number.parseFloat(style.opacity),
    });
    page.pushOperators(popGraphicsState());
  }
}

function drawCard(page: PDFPage, card: HTMLElement, origin: DOMRect, options: DrawingOptions) {
  const box = card.getBoundingClientRect();
  const style = getComputedStyle(card);
  const border = Number.parseFloat(style.borderTopWidth) || 0;
  const fill = color(style.backgroundColor);
  if (!fill && !border) return;
  const w = box.width - border, h = box.height - border;
  const r = Math.max(0, Math.min(Number.parseFloat(style.borderTopLeftRadius) - border / 2, w / 2, h / 2));
  const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
  page.drawSvgPath(path, {
    x: options.left + (box.left - origin.left + border / 2) * options.scale,
    y: options.pageHeight - options.top - (box.top - origin.top + border / 2) * options.scale,
    scale: options.scale, color: fill,
    borderColor: border ? color(style.borderTopColor) : undefined, borderWidth: border,
  });
}

/** CSS borders form fraction bars, overlines, and boxed equations. */
function drawMathBorders(page: PDFPage, card: HTMLElement, origin: DOMRect, options: DrawingOptions) {
  for (const element of card.querySelectorAll<HTMLElement>('.chapter-node-label *')) {
    if (element.closest('.katex-mathml') || element instanceof SVGElement) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    let transformScale = 1;
    for (let ancestor: Element | null = element; ancestor && ancestor !== card; ancestor = ancestor.parentElement) {
      const transform = getComputedStyle(ancestor).transform;
      if (transform !== 'none') {
        const matrix = new DOMMatrix(transform);
        transformScale *= Math.hypot(matrix.c, matrix.d);
      }
    }
    const sides = [
      { thickness: style.borderTopWidth, color: style.borderTopColor, x: box.left, y: box.top, horizontal: true },
      { thickness: style.borderBottomWidth, color: style.borderBottomColor, x: box.left, y: box.bottom, horizontal: true },
      { thickness: style.borderLeftWidth, color: style.borderLeftColor, x: box.left, y: box.top, horizontal: false },
      { thickness: style.borderRightWidth, color: style.borderRightColor, x: box.right, y: box.top, horizontal: false },
    ];
    for (const [index, side] of sides.entries()) {
      const thickness = (Number.parseFloat(side.thickness) || 0) * transformScale;
      const ink = color(side.color);
      if (!thickness || !ink) continue;
      const x = side.x - (index === 3 ? thickness : 0);
      const y = side.y - (index === 1 ? thickness : 0);
      const width = side.horizontal ? box.width : thickness;
      const height = side.horizontal ? thickness : box.height;
      page.drawRectangle({ x: options.left + (x - origin.left) * options.scale,
        y: options.pageHeight - options.top - (y + height - origin.top) * options.scale,
        width: width * options.scale, height: height * options.scale, color: ink });
    }
  }
}

export function drawDiagramShapes(page: PDFPage, element: HTMLElement, options: DrawingOptions) {
  const origin = element.getBoundingClientRect();
  for (const svg of element.querySelectorAll<SVGSVGElement>(':scope > svg')) drawSVG(page, svg, origin, options);
  for (const card of element.querySelectorAll<HTMLElement>('[data-export-node]')) {
    drawCard(page, card, origin, options);
    drawMathBorders(page, card, origin, options);
    for (const svg of card.querySelectorAll<SVGSVGElement>('svg')) drawSVG(page, svg, origin, options);
  }
}
