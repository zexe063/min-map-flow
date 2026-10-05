import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { diagramPDFSize, pdfFilename } from './pdf-layout';
import { drawDiagramShapes } from './pdf-shapes';
import { drawDiagramText } from './pdf-text';

/** Generate the PDF in this browser, with real vector shapes and embedded fonts. */
export async function createDiagramPDF(element: HTMLElement, title: string): Promise<Uint8Array> {
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  // Freeze the rendered formulas and card positions while font files are loaded.
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-50000px;top:0;pointer-events:none;';
  holder.setAttribute('aria-hidden', 'true');
  const snapshot = element.cloneNode(true) as HTMLElement;
  holder.append(snapshot);
  document.body.append(holder);
  try {
    const bounds = snapshot.getBoundingClientRect();
    const width = Math.ceil(Math.max(snapshot.scrollWidth, bounds.width));
    const height = Math.ceil(Math.max(snapshot.scrollHeight, bounds.height));
    if (width < 1 || height < 1) throw new Error('There is no map to export yet.');
    if (width > 100_000 || height > 100_000) throw new Error('This map is too spread out. Move the cards closer together and try again.');

    const size = diagramPDFSize(width, height);
    const pdf = await PDFDocument.create();
    pdf.setTitle(title);
    pdf.setCreator('Text to Roadmap');
    pdf.setProducer('Text to Roadmap');
    const page = pdf.addPage([size.width, size.height]);
    if (size.userUnit > 1) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(size.userUnit));
    const options = { left: size.left, top: size.margin, scale: size.scale, pageHeight: size.height };
    drawDiagramShapes(page, snapshot, options);
    await drawDiagramText(pdf, page, snapshot, options);
    return await pdf.save({ useObjectStreams: false });
  } finally { holder.remove(); }
}

export async function downloadDiagramPDF(element: HTMLElement, title: string): Promise<void> {
  const bytes = await createDiagramPDF(element, title);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = pdfFilename(title);
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    // Let the browser's download manager consume the URL before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
