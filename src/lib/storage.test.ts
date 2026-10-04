import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_STORAGE_KEY, loadLibrary, parseLibraryJSON, saveLibrary } from './storage';
import type { ChapterLibrary } from '../types';

function library(): ChapterLibrary {
  return {
    version: 1,
    activeId: 'chapter-one',
    chapters: [{
      id: 'chapter-one', title: 'Motion', outline: '# Motion\n## Forces', draftOutline: '# Motion\n## Forces\n- $F = ma$', updatedAt: 123,
      nodes: [
        { id: 'root', type: 'chapter', position: { x: -20, y: 0 }, style: { width: 300 }, data: { label: 'Motion', kind: 'title', notes: '' } },
        { id: 'force', type: 'chapter', position: { x: 50, y: 120 }, width: 230, height: 80, data: { label: '$F = ma$', kind: 'topic', notes: 'Remember units.', parentId: 'root' } },
      ],
      edges: [{ id: 'root-force', type: 'smoothstep', source: 'root', target: 'force', sourceHandle: 'bottom', targetHandle: 'top' }],
      viewport: { x: 10, y: 20, zoom: 0.8 },
    }],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('portable library validation', () => {
  it('preserves editable chapter data, formula sources, dimensions, draft text, and viewport', () => {
    const original = library();
    expect(parseLibraryJSON(JSON.stringify(original))).toEqual(original);
  });

  it('rejects malformed JSON, unsupported versions, and a missing active chapter', () => {
    expect(() => parseLibraryJSON('{bad')).toThrow('not valid JSON');
    expect(() => parseLibraryJSON(JSON.stringify({ ...library(), version: 2 }))).toThrow('Unsupported library version');
    expect(() => parseLibraryJSON(JSON.stringify({ ...library(), activeId: 'missing' }))).toThrow('active chapter');
  });

  it('rejects duplicate chapter and node IDs', () => {
    const chapters = library();
    chapters.chapters.push(chapters.chapters[0]);
    expect(() => parseLibraryJSON(JSON.stringify(chapters))).toThrow('duplicate ID');
    const nodes = library();
    nodes.chapters[0].nodes[1].id = 'root';
    expect(() => parseLibraryJSON(JSON.stringify(nodes))).toThrow('duplicate ID');
  });

  it('rejects broken connectors, invalid parents, and duplicate connector IDs', () => {
    const broken = library();
    broken.chapters[0].edges[0].target = 'not-a-node';
    expect(() => parseLibraryJSON(JSON.stringify(broken))).toThrow('node that does not exist');
    const parent = library();
    parent.chapters[0].nodes[1].data.parentId = 'missing';
    expect(() => parseLibraryJSON(JSON.stringify(parent))).toThrow('invalid parent');
    const duplicate = library();
    duplicate.chapters[0].edges.push(duplicate.chapters[0].edges[0]);
    expect(() => parseLibraryJSON(JSON.stringify(duplicate))).toThrow('duplicate ID');
  });

  it('rejects unbounded coordinates and non-finite JSON numbers', () => {
    const outOfBounds = library();
    outOfBounds.chapters[0].nodes[0].position.x = 1_000_001;
    expect(() => parseLibraryJSON(JSON.stringify(outOfBounds))).toThrow('finite number');
    const overflow = JSON.stringify(library()).replace('"x":-20', '"x":1e999');
    expect(() => parseLibraryJSON(overflow)).toThrow('finite number');
  });

  it('strips executable-looking extra fields and keeps HTML and prototype names as literal text', () => {
    const raw = JSON.parse(JSON.stringify(library()));
    raw.chapters[0].nodes[0].data.label = '<img src=x onerror=alert(1)> __proto__';
    raw.chapters[0].nodes[0].data.html = '<script>alert(1)</script>';
    raw.chapters[0].nodes[0].data.onClick = 'alert(1)';
    raw.chapters[0].nodes[0].selected = true;
    raw.chapters[0].nodes[0].style.backgroundImage = 'url(https://example.com/tracker)';
    raw.chapters[0].edges[0].selected = true;
    const withPrototype = JSON.stringify(raw).replace('"version":1', '"__proto__":{"polluted":true},"version":1');
    const parsed = parseLibraryJSON(withPrototype);
    expect(parsed.chapters[0].nodes[0].data).toEqual({ label: '<img src=x onerror=alert(1)> __proto__', kind: 'title', notes: '' });
    expect(parsed.chapters[0].nodes[0].style).toEqual({ width: 300 });
    expect(parsed.chapters[0].nodes[0]).not.toHaveProperty('selected');
    expect(parsed.chapters[0].edges[0]).not.toHaveProperty('selected');
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(parsed).not.toHaveProperty('polluted');
  });

  it('rejects unsupported node kinds and more than 250 nodes per chapter', () => {
    const invalid = JSON.parse(JSON.stringify(library()));
    invalid.chapters[0].nodes[0].data.kind = 'html';
    expect(() => parseLibraryJSON(JSON.stringify(invalid))).toThrow('data.kind');
    const tooMany = library();
    tooMany.chapters[0].nodes = Array.from({ length: 251 }, (_, index) => ({ ...tooMany.chapters[0].nodes[0], id: `node-${index}` }));
    expect(() => parseLibraryJSON(JSON.stringify(tooMany))).toThrow('at most 250');
  });

  it('allows an intentionally empty chapter without missing-node errors', () => {
    const empty = library();
    empty.chapters[0].nodes = [];
    empty.chapters[0].edges = [];
    expect(parseLibraryJSON(JSON.stringify(empty)).chapters[0].nodes).toEqual([]);
  });
});

describe('browser persistence', () => {
  it('round-trips the library through browser storage', () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => items.set(key, value) });
    expect(loadLibrary()).toBeNull();
    saveLibrary(library());
    expect(items.has(LIBRARY_STORAGE_KEY)).toBe(true);
    expect(loadLibrary()).toEqual(library());
  });

  it('recovers from corrupt storage and surfaces quota failure instead of claiming a save', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'corrupt', setItem: () => { throw new Error('QuotaExceededError'); } });
    expect(loadLibrary()).toBeNull();
    expect(() => saveLibrary(library())).toThrow('Download your library JSON');
  });
});
