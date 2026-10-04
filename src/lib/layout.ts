import type { MapEdge, MapNode, NodeKind } from '../types';

export const NODE_WIDTHS: Record<NodeKind, number> = {
  title: 480,
  section: 300,
  topic: 300,
  subtopic: 300,
};

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** A conservative first pass; subsequent layouts use React Flow's measured size. */
export function nodeSize(node: MapNode): { width: number; height: number } {
  const width = [node.measured?.width, node.width, node.style?.width].find(positive)
    ?? NODE_WIDTHS[node.data.kind];
  const actualHeight = [node.measured?.height, node.height, node.style?.height].find(positive);
  if (actualHeight !== undefined) return { width, height: actualHeight };

  const fontWidth = node.data.kind === 'title' ? 14 : 8.5;
  const lineHeight = node.data.kind === 'title' ? 48 : 24;
  const charactersPerLine = Math.max(8, Math.floor((width - 40) / fontWidth));
  let label = node.data.label;
  let mathHeight = 0;
  label = label.replace(/\$\$([\s\S]*?)\$\$/g, (_, formula: string) => {
    mathHeight += 44 + (/\\(?:frac|dfrac|sum|int|begin)/.test(formula) ? 14 : 0);
    return '';
  });
  const lines = label.trim().split('\n').reduce((total, line) => {
    // TeX commands are shorter when rendered, but a little overestimation keeps
    // fresh, unmeasured cards apart even with inline fractions and subscripts.
    const text = line.replace(/\\[a-zA-Z]+/g, 'xx');
    return total + Math.max(1, Math.ceil(text.length / charactersPerLine));
  }, 0);
  const minimum = node.data.kind === 'title' ? 68 : node.data.kind === 'section' ? 46 : 54;
  const padding = node.data.kind === 'title' || node.data.kind === 'section' ? 20 : 30;
  return { width, height: Math.max(minimum, lines * lineHeight + padding + mathHeight) };
}

/** The latest incoming connection wins when a card is moved to another branch. */
export function graphParents(nodes: MapNode[], edges: MapEdge[]): Map<string, string> {
  const ids = new Set(nodes.map((node) => node.id));
  const parents = new Map<string, string>();
  for (const node of nodes) {
    const parent = node.data.parentId;
    if (parent && parent !== node.id && ids.has(parent)) parents.set(node.id, parent);
  }
  for (const edge of edges) {
    if (edge.source !== edge.target && ids.has(edge.source) && ids.has(edge.target)) {
      parents.set(edge.target, edge.source);
    }
  }
  return parents;
}

/** Keep structural links usable with both side branches and manually moved cards. */
export function routeEdges(nodes: MapNode[], edges: MapEdge[]): MapEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (source?.data.kind !== 'topic' || target?.data.kind !== 'subtopic') return edge;
    const sourceCenter = source.position.x + nodeSize(source).width / 2;
    const targetCenter = target.position.x + nodeSize(target).width / 2;
    if (Math.abs(sourceCenter - targetCenter) < 1) {
      const side = sourceCenter < 0 ? 'left' : 'right';
      return { ...edge, sourceHandle: side, targetHandle: side };
    }
    const towardRight = targetCenter > sourceCenter;
    return { ...edge, sourceHandle: towardRight ? 'right' : 'left', targetHandle: towardRight ? 'left' : 'right' };
  });
}

/**
 * The visible roadmap follows a continuous spine. These are display edges;
 * callers retain the supplied structural edges for editing and serialization.
 */
export function roadmapEdges(nodes: MapNode[], structuralEdges: MapEdge[]): MapEdge[] {
  const spine = nodes.filter((node) => node.data.kind !== 'subtopic');
  const edges: MapEdge[] = [];
  const style = { stroke: '#2b78e4', strokeWidth: 3.5, strokeLinecap: 'round' as const };
  for (let index = 1; index < spine.length; index += 1) {
    edges.push({
      id: `spine-${spine[index - 1].id}-${spine[index].id}`,
      source: spine[index - 1].id,
      target: spine[index].id,
      sourceHandle: 'bottom',
      targetHandle: 'top',
      type: 'straight',
      style: { ...style, strokeDasharray: '0' },
    });
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parents = graphParents(nodes, structuralEdges);
  for (const node of nodes) {
    if (node.data.kind !== 'subtopic') continue;
    const parent = byId.get(parents.get(node.id) ?? '');
    if (!parent) continue;
    edges.push({
      id: `branch-${parent.id}-${node.id}`,
      source: parent.id,
      target: node.id,
      type: 'default',
      sourceHandle: 'right',
      targetHandle: 'left',
      style: { ...style, strokeDasharray: '0.8 8' },
    });
  }
  return routeEdges(nodes, edges);
}

/**
 * Titles, section labels, and topics share a central spine. Topic children form
 * alternating right and left stacks, with independent space reserved on each
 * side. Variable measured heights keep math and wrapped labels clear.
 */
export function layoutNodes(nodes: MapNode[], edges: MapEdge[]): MapNode[] {
  if (nodes.length === 0) return [];
  const sizes = new Map(nodes.map((node) => [node.id, nodeSize(node)]));
  const parents = graphParents(nodes, edges);
  const children = new Map<string, MapNode[]>();
  for (const node of nodes) {
    const parentId = parents.get(node.id);
    if (!parentId) continue;
    const siblings = children.get(parentId) ?? [];
    siblings.push(node);
    children.set(parentId, siblings);
  }
  const positions = new Map<string, { x: number; y: number }>();
  let cursor = 0;
  const place = (node: MapNode, center: number, y: number) => {
    const size = sizes.get(node.id)!;
    positions.set(node.id, { x: center - size.width / 2, y });
    return y + size.height;
  };
  const reserved = new Set<string>();
  const collectChildren = (parent: MapNode): MapNode[] => {
    const result: MapNode[] = [];
    const visit = (node: MapNode) => {
      if (positions.has(node.id) || reserved.has(node.id)) return;
      if (node.data.kind !== 'subtopic') return;
      reserved.add(node.id);
      result.push(node);
      for (const child of children.get(node.id) ?? []) visit(child);
    };
    for (const child of children.get(parent.id) ?? []) visit(child);
    return result;
  };
  const spine = nodes.filter((node) => node.data.kind !== 'subtopic');
  // Reserve a continuous clear corridor even when one central card is wider.
  const spineHalfWidth = Math.max(150, ...spine.filter((node) => node.data.kind !== 'title').map((node) => sizes.get(node.id)!.width / 2));
  const branchEdge = spineHalfWidth + 120;
  const sideBottom = { left: 0, right: 0 };
  let side: 'left' | 'right' = 'right';
  const childGap = 8;
  let hasTopicsInSection = false;

  for (const node of spine) {
    const size = sizes.get(node.id)!;
    if (node.data.kind !== 'topic') {
      if (node.data.kind === 'section' && hasTopicsInSection) {
        cursor = Math.max(cursor, sideBottom.left, sideBottom.right) + 40;
      }
      const bottom = place(node, 0, cursor);
      cursor = bottom + (node.data.kind === 'title' ? 35 : 30);
      sideBottom.left = Math.max(sideBottom.left, bottom + 10);
      sideBottom.right = Math.max(sideBottom.right, bottom + 10);
      hasTopicsInSection = false;
      continue;
    }
    hasTopicsInSection = true;
    const group = collectChildren(node);
    if (!group.length) {
      cursor = place(node, 0, cursor) + 30;
      continue;
    }
    // Center on the complete measured stack, including taller math cards.
    const groupHeight = group.reduce((height, child) => height + sizes.get(child.id)!.height, 0) + childGap * (group.length - 1);
    const anchor = groupHeight / 2;
    const groupTop = Math.max(sideBottom[side] + 20, cursor + size.height / 2 - anchor);
    const topicTop = groupTop + anchor - size.height / 2;
    cursor = place(node, 0, topicTop) + 30;
    let childY = groupTop;
    for (const child of group) {
      const childSize = sizes.get(child.id)!;
      const center = side === 'right' ? branchEdge + childSize.width / 2 : -branchEdge - childSize.width / 2;
      childY = place(child, center, childY) + childGap;
    }
    sideBottom[side] = childY - childGap;
    side = side === 'right' ? 'left' : 'right';
  }

  // Keep incomplete or cyclic imported graphs visible without overlapping the
  // arranged chapter. Normal parsed outlines have no remaining cards here.
  cursor = Math.max(cursor, sideBottom.left, sideBottom.right) + 40;
  for (const node of nodes) {
    if (!positions.has(node.id)) cursor = place(node, 0, cursor) + 20;
  }

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
    style: { ...node.style, width: sizes.get(node.id)!.width },
  }));
}
