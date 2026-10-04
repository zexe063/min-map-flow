import type { MapEdge, MapNode, NodeKind } from '../types';
import { graphParents, layoutNodes, routeEdges } from './layout';

export interface ParsedOutline {
  title: string;
  nodes: MapNode[];
  edges: MapEdge[];
  warnings: string[];
}

export const MAX_OUTLINE_NODES = 250;

function displayDelimiters(line: string): number {
  let count = 0;
  for (let index = 0; index < line.length - 1; index += 1) {
    if (line[index] !== '$' || line[index + 1] !== '$') continue;
    let precedingSlashes = 0;
    for (let before = index - 1; before >= 0 && line[before] === '\\'; before -= 1) precedingSlashes += 1;
    if (precedingSlashes % 2 === 0) {
      count += 1;
      index += 1;
    }
  }
  return count;
}

/** Parse the deliberately small, portable Markdown chapter hierarchy. */
export function parseOutline(source: string): ParsedOutline {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const firstLine = lines.findIndex((line) => line.trim().length > 0);
  if (firstLine < 0) throw new Error('Line 1: Add a chapter title with #, then sections with ## and topics with ###.');
  let lastLine = lines.length - 1;
  while (lastLine > firstLine && !lines[lastLine].trim()) lastLine -= 1;
  const fence = lines[firstLine].trim().match(/^(`{3,}|~{3,})(?:[\w+-]+)?\s*$/);
  if (fence) {
    const closePattern = new RegExp(`^${fence[1][0]}{${fence[1].length},}\\s*$`);
    if (lastLine === firstLine || !closePattern.test(lines[lastLine].trim())) {
      throw new Error(`Line ${firstLine + 1}: Close the pasted code fence with ${fence[1]}.`);
    }
    lines[firstLine] = '';
    lines[lastLine] = '';
  }

  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  let title: MapNode | undefined;
  let section: MapNode | undefined;
  let topic: MapNode | undefined;
  let mathStartLine: number | undefined;
  let lastNode: MapNode | undefined;

  const fail = (line: number, message: string): never => {
    throw new Error(`Line ${line}: ${message}`);
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    if (mathStartLine !== undefined && lastNode) {
      lastNode.data.label += `\n${rawLine}`;
      if (displayDelimiters(rawLine) % 2 === 1) mathStartLine = undefined;
      return;
    }
    const line = rawLine.trim();
    if (!line) return;
    let kind: NodeKind;
    let label: string;
    const heading = line.match(/^(#{1,6})(?:\s+(.*))?$/);
    const bullet = line.match(/^-(?:\s+(.*))?$/);
    if (heading) {
      if (heading[1].length > 3) fail(lineNumber, 'Use ### for a topic and - for a subtopic; headings deeper than ### are not supported.');
      kind = heading[1].length === 1 ? 'title' : heading[1].length === 2 ? 'section' : 'topic';
      label = (heading[2] ?? '').trim();
    } else if (bullet) {
      kind = 'subtopic';
      label = (bullet[1] ?? '').trim();
    } else if (line.startsWith('$$') && lastNode) {
      lastNode.data.label += `\n${rawLine}`;
      if (displayDelimiters(rawLine) % 2 === 1) mathStartLine = lineNumber;
      return;
    } else {
      fail(lineNumber, 'Start each item with # (chapter), ## (section), ### (topic), or - (subtopic).');
    }

    if (!label!) fail(lineNumber, 'Give this item a name after its Markdown marker.');
    let parent: MapNode | undefined;
    if (kind! === 'title') {
      if (title) fail(lineNumber, 'Use one # chapter title. Add another section with ##.');
    } else {
      if (!title) fail(lineNumber, 'Add a # chapter title before any sections or topics.');
      if (kind! === 'section') parent = title;
      if (kind! === 'topic') {
        if (!section) fail(lineNumber, 'Add a ## section before a ### topic.');
        parent = section;
      }
      if (kind! === 'subtopic') {
        if (!topic) fail(lineNumber, 'Add a ### topic before a - subtopic.');
        parent = topic;
      }
    }
    if (nodes.length >= MAX_OUTLINE_NODES) fail(lineNumber, `A chapter can contain up to ${MAX_OUTLINE_NODES} items. Split this outline into smaller chapters.`);
    const node: MapNode = {
      id: `node-${nodes.length + 1}`,
      type: 'chapter',
      position: { x: 0, y: 0 },
      data: { label: label!, kind: kind!, notes: '', ...(parent ? { parentId: parent.id } : {}) },
    };
    nodes.push(node);
    if (parent) edges.push({
      id: `edge-${parent.id}-${node.id}`,
      source: parent.id,
      target: node.id,
      type: 'smoothstep',
      sourceHandle: 'bottom',
      targetHandle: 'top',
    });
    if (kind! === 'title') title = node;
    if (kind! === 'section') {
      section = node;
      topic = undefined;
    }
    if (kind! === 'topic') topic = node;
    lastNode = node;
    if (displayDelimiters(label!) % 2 === 1) mathStartLine = lineNumber;
  });
  if (mathStartLine !== undefined) fail(mathStartLine, 'Close this display equation with $$.');
  if (!title || nodes.length === 0) fail(firstLine + 1, 'Add a chapter title with #, then sections with ## and topics with ###.');

  const warnings: string[] = [];
  if (!nodes.some((node) => node.data.kind === 'section')) warnings.push('Add ## sections to organize your chapter.');
  const arrangedNodes = layoutNodes(nodes, edges);
  return { title: title!.data.label, nodes: arrangedNodes, edges: routeEdges(arrangedNodes, edges), warnings };
}

/** Serialize current card text and connections, preserving LaTeX verbatim. */
export function outlineFromGraph(nodes: MapNode[], edges: MapEdge[]): string {
  if (nodes.length === 0) return '';
  const parents = graphParents(nodes, edges);
  const children = new Map<string, MapNode[]>();
  for (const node of nodes) {
    const parent = parents.get(node.id);
    if (!parent) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(node);
    children.set(parent, siblings);
  }
  const lines: string[] = [];
  const visited = new Set<string>();
  const markers: Record<NodeKind, string> = { title: '#', section: '##', topic: '###', subtopic: '-' };
  const visit = (node: MapNode) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    if ((node.data.kind === 'section' || node.data.kind === 'topic') && lines.length) lines.push('');
    lines.push(`${markers[node.data.kind]} ${node.data.label}`);
    for (const child of children.get(node.id) ?? []) visit(child);
  };
  for (const node of nodes.filter((node) => node.data.kind === 'title')) visit(node);
  for (const node of nodes.filter((node) => !parents.has(node.id))) visit(node);
  for (const node of nodes) visit(node);
  return lines.join('\n');
}
