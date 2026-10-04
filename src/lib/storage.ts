import type { Chapter, ChapterLibrary, MapEdge, MapNode, NodeKind } from '../types';

export const LIBRARY_STORAGE_KEY = 'chaptermap.library.v1';
const MAX_JSON_LENGTH = 16_000_000;
const MAX_SOURCE_LENGTH = 150_000;
const NODE_KINDS = new Set<NodeKind>(['title', 'section', 'topic', 'subtopic']);
const EDGE_TYPES = new Set(['default', 'straight', 'step', 'smoothstep', 'simplebezier']);

type RecordValue = Record<string, unknown>;

function object(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as RecordValue;
}

function string(value: unknown, path: string, limit: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > limit || (nonempty && !value.trim())) {
    throw new Error(`${path} must be ${nonempty ? 'a nonempty' : 'a'} string of at most ${limit.toLocaleString()} characters.`);
  }
  return value;
}

function number(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} must be a finite number between ${min} and ${max}.`);
  }
  return value;
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new Error(`${path} must be a list with at most ${max} items.`);
  }
  return value;
}

function unique(id: string, ids: Set<string>, path: string) {
  if (ids.has(id)) throw new Error(`${path} contains the duplicate ID “${id}”.`);
  ids.add(id);
}

function parseNode(value: unknown, path: string): MapNode {
  const source = object(value, path);
  const data = object(source.data, `${path}.data`);
  const position = object(source.position, `${path}.position`);
  if (source.type !== undefined && source.type !== 'chapter') {
    throw new Error(`${path}.type must be “chapter”.`);
  }
  if (!NODE_KINDS.has(data.kind as NodeKind)) {
    throw new Error(`${path}.data.kind must be title, section, topic, or subtopic.`);
  }
  const node: MapNode = {
    id: string(source.id, `${path}.id`, 160, true),
    type: 'chapter',
    position: {
      x: number(position.x, `${path}.position.x`, -1_000_000, 1_000_000),
      y: number(position.y, `${path}.position.y`, -1_000_000, 1_000_000),
    },
    data: {
      label: string(data.label, `${path}.data.label`, 12_000),
      kind: data.kind as NodeKind,
      notes: data.notes === undefined ? '' : string(data.notes, `${path}.data.notes`, 30_000),
    },
  };
  if (data.parentId !== undefined) {
    node.data.parentId = string(data.parentId, `${path}.data.parentId`, 160, true);
  }
  for (const dimension of ['width', 'height'] as const) {
    if (source[dimension] !== undefined) {
      node[dimension] = number(source[dimension], `${path}.${dimension}`, 1, 10_000);
    }
  }
  // Only dimensions are transferable styles. Imported HTML, callbacks, CSS,
  // selection state, and arbitrary application data never enter the renderer.
  if (source.style !== undefined) {
    const style = object(source.style, `${path}.style`);
    const dimensions: { width?: number; height?: number } = {};
    for (const key of ['width', 'height'] as const) {
      if (style[key] !== undefined) {
        dimensions[key] = number(style[key], `${path}.style.${key}`, 1, 10_000);
      }
    }
    if (Object.keys(dimensions).length) node.style = dimensions;
  }
  return node;
}

function parseEdge(value: unknown, path: string, nodeIds: Set<string>): MapEdge {
  const source = object(value, path);
  const edge: MapEdge = {
    id: string(source.id, `${path}.id`, 340, true),
    source: string(source.source, `${path}.source`, 160, true),
    target: string(source.target, `${path}.target`, 160, true),
    type: 'smoothstep',
  };
  if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
    throw new Error(`${path} connects to a node that does not exist.`);
  }
  if (source.type !== undefined) {
    if (typeof source.type !== 'string' || !EDGE_TYPES.has(source.type)) {
      throw new Error(`${path}.type is not a supported connector type.`);
    }
    edge.type = source.type;
  }
  for (const handle of ['sourceHandle', 'targetHandle'] as const) {
    if (source[handle] !== undefined && source[handle] !== null) {
      edge[handle] = string(source[handle], `${path}.${handle}`, 160, true);
    }
  }
  if (source.animated !== undefined) {
    if (typeof source.animated !== 'boolean') throw new Error(`${path}.animated must be true or false.`);
    edge.animated = source.animated;
  }
  return edge;
}

function parseChapter(value: unknown, index: number): Chapter {
  const path = `Chapter ${index + 1}`;
  const source = object(value, path);
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const nodes = array(source.nodes, `${path}.nodes`, 250).map((entry, nodeIndex) => {
    const node = parseNode(entry, `${path}, node ${nodeIndex + 1}`);
    unique(node.id, nodeIds, `${path}.nodes`);
    return node;
  });
  for (const node of nodes) {
    if (node.data.parentId !== undefined && (!nodeIds.has(node.data.parentId) || node.data.parentId === node.id)) {
      throw new Error(`${path}, node “${node.id}” has an invalid parent.`);
    }
  }
  const edges = array(source.edges, `${path}.edges`, 1_000).map((entry, edgeIndex) => {
    const edge = parseEdge(entry, `${path}, connector ${edgeIndex + 1}`, nodeIds);
    unique(edge.id, edgeIds, `${path}.edges`);
    return edge;
  });
  const chapter: Chapter = {
    id: string(source.id, `${path}.id`, 160, true),
    title: string(source.title, `${path}.title`, 300, true),
    outline: string(source.outline, `${path}.outline`, MAX_SOURCE_LENGTH),
    nodes,
    edges,
    updatedAt: number(source.updatedAt, `${path}.updatedAt`, 0, Number.MAX_SAFE_INTEGER),
  };
  if (source.draftOutline !== undefined) {
    chapter.draftOutline = string(source.draftOutline, `${path}.draftOutline`, MAX_SOURCE_LENGTH);
  }
  if (source.layoutVersion !== undefined) {
    chapter.layoutVersion = number(source.layoutVersion, `${path}.layoutVersion`, 1, 100);
  }
  if (source.viewport !== undefined) {
    const viewport = object(source.viewport, `${path}.viewport`);
    chapter.viewport = {
      x: number(viewport.x, `${path}.viewport.x`, -1_000_000, 1_000_000),
      y: number(viewport.y, `${path}.viewport.y`, -1_000_000, 1_000_000),
      zoom: number(viewport.zoom, `${path}.viewport.zoom`, 0.01, 100),
    };
  }
  return chapter;
}

/** Parse a portable library into known, validated application fields only. */
export function parseLibraryJSON(text: string): ChapterLibrary {
  if (text.length > MAX_JSON_LENGTH) throw new Error('This library is too large. The limit is 16 MB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON. Choose a Chaptermap library export.');
  }
  const source = object(parsed, 'Library');
  if (source.version !== 1) throw new Error('Unsupported library version. This editor reads version 1 exports.');
  const chapters = array(source.chapters, 'Library.chapters', 100).map(parseChapter);
  if (!chapters.length) throw new Error('A library must contain at least one chapter.');
  const chapterIds = new Set<string>();
  for (const chapter of chapters) unique(chapter.id, chapterIds, 'Library.chapters');
  const activeId = string(source.activeId, 'Library.activeId', 160, true);
  if (!chapterIds.has(activeId)) throw new Error('The active chapter does not exist in this library.');
  return { version: 1, activeId, chapters };
}

export function loadLibrary(): ChapterLibrary | null {
  try {
    const saved = localStorage.getItem(LIBRARY_STORAGE_KEY);
    return saved ? parseLibraryJSON(saved) : null;
  } catch {
    return null;
  }
}

export function saveLibrary(library: ChapterLibrary): void {
  const canonical = parseLibraryJSON(JSON.stringify(library));
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(canonical));
  } catch {
    throw new Error('Browser storage is full or unavailable. Download your library JSON to keep a backup.');
  }
}

export function downloadLibrary(library: ChapterLibrary): void {
  const canonical = parseLibraryJSON(JSON.stringify(library));
  const blob = new Blob([JSON.stringify(canonical, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'chaptermap-library.json';
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
