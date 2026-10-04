import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import './math-components.css';

export type MathTextPart =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string; display: boolean };

function isEscaped(text: string, index: number) {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

/** Parse only dollar-delimited math; everything else remains ordinary text. */
export function parseMathText(text: string): MathTextPart[] {
  const parts: MathTextPart[] = [];
  let plain = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '$') {
      plain += text[index++];
      continue;
    }
    if (isEscaped(text, index)) {
      plain = plain.slice(0, -1) + '$';
      index += 1;
      continue;
    }
    const display = text[index + 1] === '$';
    const delimiter = display ? '$$' : '$';
    let end = index + delimiter.length;
    while (end < text.length) {
      end = text.indexOf(delimiter, end);
      if (end === -1 || !isEscaped(text, end)) break;
      end += delimiter.length;
    }
    if (end === -1 || end >= text.length || !text.slice(index + delimiter.length, end).trim()) {
      plain += delimiter;
      index += delimiter.length;
      continue;
    }
    if (plain) parts.push({ type: 'text', value: plain });
    plain = '';
    parts.push({ type: 'math', value: text.slice(index + delimiter.length, end), display });
    index = end + delimiter.length;
  }
  if (plain) parts.push({ type: 'text', value: plain });
  return parts;
}

function Formula({ source, display }: { source: string; display: boolean }) {
  const contentRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<{ width: number; height: number; scale: number }>();
  const result = useMemo(() => {
    try {
      const html = katex.renderToString(source, {
        displayMode: display,
        throwOnError: false,
        trust: false,
        strict: 'warn',
        output: 'htmlAndMathml',
      });
      return { html, error: html.includes('class="katex-error"') };
    } catch {
      return { html: '', error: true };
    }
  }, [source, display]);

  useEffect(() => {
    const content = contentRef.current;
    const container = content?.closest<HTMLElement>('.math-text');
    if (!content || !container || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const available = container.clientWidth;
      const width = content.offsetWidth;
      const height = content.offsetHeight;
      if (!available || !width || !height) return;
      const scale = Math.min(1, available / width);
      setSize((previous) => {
        if (previous?.width === width && previous.height === height && previous.scale === scale) return previous;
        return { width, height, scale };
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(container);
    measure();
    // KaTeX fonts can finish loading after the card's first measurement.
    let active = true;
    void document.fonts?.ready.then(() => { if (active) measure(); });
    return () => { active = false; observer.disconnect(); };
  }, [result.html]);

  return (
    <span
      className={`math-formula${display ? ' math-formula--display' : ''}${result.error ? ' math-formula--error' : ''}`}
      data-math-error={result.error || undefined}
      title={result.error ? `Check this formula: ${source}` : undefined}
    >
      <span className="math-formula-fit" style={size ? { width: size.width * size.scale, height: size.height * size.scale } : undefined}>
        <span
          ref={contentRef}
          className="math-formula-content"
          style={size ? { transform: `scale(${size.scale})` } : undefined}
        >
          {result.html ? <span dangerouslySetInnerHTML={{ __html: result.html }} /> : <code>{source}</code>}
        </span>
      </span>
    </span>
  );
}

export interface MathTextProps {
  text: string;
  className?: string;
  /** Display all delimited equations on their own line. Plain text is unchanged. */
  display?: boolean;
}

export function MathText({ text, className = '', display = false }: MathTextProps) {
  const parts = useMemo(() => parseMathText(text), [text]);
  return (
    <span className={`math-text ${className}`.trim()}>
      {parts.map((part, index) => part.type === 'text'
        ? <span key={index}>{part.value}</span>
        : <Formula key={index} source={part.value} display={part.display || display} />)}
    </span>
  );
}

export default MathText;
