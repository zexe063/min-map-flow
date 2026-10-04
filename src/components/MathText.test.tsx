import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MathText, { parseMathText } from './MathText';

describe('math text', () => {
  it('keeps inline and block math separate from the surrounding prose', () => {
    expect(parseMathText('For $x^2$, use\n$$\\frac{a}{b}$$')).toEqual([
      { type: 'text', value: 'For ' },
      { type: 'math', value: 'x^2', display: false },
      { type: 'text', value: ', use\n' },
      { type: 'math', value: '\\frac{a}{b}', display: true },
    ]);
  });

  it('shows escaped dollars and unmatched delimiters as literal text', () => {
    expect(parseMathText('Price: \\$5; unfinished $x')).toEqual([
      { type: 'text', value: 'Price: $5; unfinished $x' },
    ]);
  });

  it('leaves escaped dollars inside formulas intact for KaTeX', () => {
    expect(parseMathText('$\\text{\\$5}$')).toEqual([
      { type: 'math', value: '\\text{\\$5}', display: false },
    ]);
  });

  it('produces real accessible KaTeX markup while escaping user text', () => {
    const html = renderToStaticMarkup(<MathText text={'<img src=x onerror=alert(1)> $x^2$'} />);
    expect(html).toContain('class="katex"');
    expect(html).toContain('<math');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });

  it('keeps malformed formulas visible without throwing', () => {
    const html = renderToStaticMarkup(<MathText text={'Try $\\frac{1}{$ please'} />);
    expect(html).toContain('data-math-error="true"');
    expect(html).toContain('\\frac{1}{');
    expect(html).toContain('please');
  });

  it('does not allow a formula to create an HTML link', () => {
    const html = renderToStaticMarkup(<MathText text={'$\\href{javascript:alert(1)}{click}$'} />);
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href="javascript:');
  });
});
