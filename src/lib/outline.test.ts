import { describe, expect, it } from 'vitest';
import { getBezierPath, getStraightPath, Position } from '@xyflow/react';
import type { MapEdge, MapNode } from '../types';
import { createDemoChapter, DEMO_OUTLINE } from './demo';
import { layoutNodes, nodeSize, roadmapEdges, routeEdges } from './layout';
import { outlineFromGraph, parseOutline } from './outline';

function expectNoOverlaps(nodes: MapNode[]) {
  for (let first = 0; first < nodes.length; first += 1) {
    for (let second = first + 1; second < nodes.length; second += 1) {
      const a = nodes[first];
      const b = nodes[second];
      const aSize = nodeSize(a);
      const bSize = nodeSize(b);
      const overlaps = a.position.x < b.position.x + bSize.width
        && a.position.x + aSize.width > b.position.x
        && a.position.y < b.position.y + bSize.height
        && a.position.y + aSize.height > b.position.y;
      expect(overlaps, `${a.data.label} overlaps ${b.data.label}`).toBe(false);
    }
  }
}

function expectRoutesClear(nodes: MapNode[], edges: MapEdge[]) {
  const handlePoint = (node: MapNode, handle: string | null | undefined) => {
    const { width, height } = nodeSize(node);
    const side = (handle ?? 'bottom') as 'top' | 'bottom' | 'left' | 'right';
    const positions = { top: Position.Top, bottom: Position.Bottom, left: Position.Left, right: Position.Right };
    return {
      x: node.position.x + (side === 'left' ? 0 : side === 'right' ? width : width / 2),
      y: node.position.y + (side === 'top' ? 0 : side === 'bottom' ? height : height / 2),
      position: positions[side],
    };
  };
  for (const edge of edges) {
    const source = handlePoint(nodes.find((node) => node.id === edge.source)!, edge.sourceHandle);
    const target = handlePoint(nodes.find((node) => node.id === edge.target)!, edge.targetHandle);
    const endpoints = { sourceX: source.x, sourceY: source.y, sourcePosition: source.position, targetX: target.x, targetY: target.y, targetPosition: target.position };
    const [path] = edge.type === 'straight' ? getStraightPath(endpoints) : getBezierPath(endpoints);
    const tokens = path.match(/[MLQC]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!;
    const points: { x: number; y: number }[] = [];
    let point = { x: 0, y: 0 };
    for (let index = 0; index < tokens.length;) {
      const command = tokens[index++];
      const next = { x: Number(tokens[index++]), y: Number(tokens[index++]) };
      if (command === 'M') point = next;
      if (command === 'L') {
        for (let step = 0; step <= 30; step += 1) {
          const t = step / 30;
          points.push({ x: point.x + (next.x - point.x) * t, y: point.y + (next.y - point.y) * t });
        }
        point = next;
      }
      if (command === 'Q') {
        const end = { x: Number(tokens[index++]), y: Number(tokens[index++]) };
        for (let step = 0; step <= 30; step += 1) {
          const t = step / 30;
          points.push({ x: (1 - t) ** 2 * point.x + 2 * (1 - t) * t * next.x + t ** 2 * end.x, y: (1 - t) ** 2 * point.y + 2 * (1 - t) * t * next.y + t ** 2 * end.y });
        }
        point = end;
      }
      if (command === 'C') {
        const secondControl = { x: Number(tokens[index++]), y: Number(tokens[index++]) };
        const end = { x: Number(tokens[index++]), y: Number(tokens[index++]) };
        for (let step = 0; step <= 30; step += 1) {
          const t = step / 30;
          const s = 1 - t;
          points.push({ x: s ** 3 * point.x + 3 * s ** 2 * t * next.x + 3 * s * t ** 2 * secondControl.x + t ** 3 * end.x, y: s ** 3 * point.y + 3 * s ** 2 * t * next.y + 3 * s * t ** 2 * secondControl.y + t ** 3 * end.y });
        }
        point = end;
      }
    }
    expect(points.length).toBeGreaterThan(0);
    const blocker = nodes.find((node) => {
      if (node.id === edge.source || node.id === edge.target) return false;
      const { width, height } = nodeSize(node);
      return points.some(({ x, y }) => x > node.position.x + 0.1 && x < node.position.x + width - 0.1 && y > node.position.y + 0.1 && y < node.position.y + height - 0.1);
    });
    expect(blocker?.id, `${edge.id} passes through ${blocker?.data.label}`).toBeUndefined();
  }
}

describe('parseOutline', () => {
  it('builds an ordered hierarchy with valid parent edges', () => {
    const parsed = parseOutline('# Chapter\n## Section\n### Topic\n- First\n- Second');
    expect(parsed.title).toBe('Chapter');
    expect(parsed.nodes.map((node) => node.data.kind)).toEqual(['title', 'section', 'topic', 'subtopic', 'subtopic']);
    expect(parsed.edges).toHaveLength(4);
    const ids = new Set(parsed.nodes.map((node) => node.id));
    for (const edge of parsed.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
      expect(parsed.nodes.find((node) => node.id === edge.target)?.data.parentId).toBe(edge.source);
    }
    expect(parsed.edges[3].source).toBe(parsed.nodes[2].id);
    expectNoOverlaps(parsed.nodes);
  });

  it.each([
    ['', /Line 1:.*chapter title/],
    ['## Missing title', /Line 1:.*# chapter title/],
    ['# Chapter\n### No section', /Line 2:.*## section/],
    ['# Chapter\n## Section\n- No topic', /Line 3:.*### topic/],
    ['# Chapter\n## A\n### Topic\n## B\n- No topic in B', /Line 5:.*### topic/],
    ['# First\n# Second', /Line 2:.*one # chapter title/],
    ['# Chapter\n#### Too deep', /Line 2:.*deeper than ###/],
    ['# Chapter\n##', /Line 2:.*name/],
    ['# Chapter\nUnmarked item', /Line 2:.*Start each item/],
  ])('reports a useful hierarchy error for %j', (source, error) => {
    expect(() => parseOutline(source)).toThrow(error);
  });

  it('preserves inline and multiline display LaTeX exactly', () => {
    const source = String.raw`# Calculus
## Motion
### Velocity $v = \frac{dx}{dt}$
- Integrate
$$
\Delta x = \int_{t_0}^{t_1} v(t)\,dt
$$`;
    const parsed = parseOutline(source);
    expect(parsed.nodes[2].data.label).toBe(String.raw`Velocity $v = \frac{dx}{dt}$`);
    expect(parsed.nodes[3].data.label).toBe(String.raw`Integrate
$$
\Delta x = \int_{t_0}^{t_1} v(t)\,dt
$$`);
    expect(parseOutline(outlineFromGraph(parsed.nodes, parsed.edges)).nodes.map((node) => node.data.label))
      .toEqual(parsed.nodes.map((node) => node.data.label));
  });

  it('accepts enclosing Markdown code fences and Windows line endings', () => {
    const parsed = parseOutline(' \r\n```markdown\r\n# Chapter\r\n## Section\r\n### Topic\r\n- Subtopic\r\n```\r\n');
    expect(parsed.nodes).toHaveLength(4);
    expect(() => parseOutline('```md\n# Open')).toThrow(/Line 1:.*code fence/);
  });

  it('keeps original pasted line numbers in fenced error messages', () => {
    expect(() => parseOutline('```markdown\n# Chapter\n### Topic\n```')).toThrow(/Line 3:.*## section/);
  });

  it('reports an unclosed display equation at its opening line', () => {
    expect(() => parseOutline('# Chapter\n## Section\n### Equation $$x^2')).toThrow(/Line 3:.*Close this display equation/);
  });

  it('enforces the chapter size limit without truncating the outline', () => {
    const prefix = '# Chapter\n## Section\n### Topic\n';
    expect(parseOutline(prefix + Array.from({ length: 247 }, (_, index) => `- Item ${index}`).join('\n')).nodes).toHaveLength(250);
    expect(() => parseOutline(prefix + Array.from({ length: 248 }, (_, index) => `- Item ${index}`).join('\n')))
      .toThrow(/Line 251:.*250 items/);
  });
});

describe('outlineFromGraph', () => {
  it('uses edited text and the latest incoming edge when a topic is reparented', () => {
    const parsed = parseOutline('# Original\n## First\n### Moved topic\n- Detail\n## Second\n### Existing topic');
    parsed.nodes[0].data.label = 'Edited title';
    parsed.nodes[3].data.label = String.raw`Edited $\alpha$`;
    const moved: MapEdge = { id: 'new-parent', source: parsed.nodes[4].id, target: parsed.nodes[2].id };
    const exported = outlineFromGraph(parsed.nodes, [...parsed.edges, moved]);
    const roundtrip = parseOutline(exported);
    expect(roundtrip.title).toBe('Edited title');
    const movedTopic = roundtrip.nodes.find((node) => node.data.label === 'Moved topic')!;
    expect(roundtrip.nodes.find((node) => node.id === movedTopic.data.parentId)?.data.label).toBe('Second');
    expect(roundtrip.nodes.some((node) => node.data.label === String.raw`Edited $\alpha$`)).toBe(true);
  });

  it('includes every node once if editing leaves disconnected cards or a cycle', () => {
    const parsed = parseOutline('# Chapter\n## Section\n### Topic\n- Detail');
    const edges: MapEdge[] = [
      { id: 'a', source: 'node-3', target: 'node-4' },
      { id: 'b', source: 'node-4', target: 'node-3' },
    ];
    const exported = outlineFromGraph(parsed.nodes, edges);
    expect(exported.match(/### Topic/g)).toHaveLength(1);
    expect(exported.match(/- Detail/g)).toHaveLength(1);
  });
});

describe('layoutNodes', () => {
  it('uses a central spine and alternating side stacks without overlaps', () => {
    const parsed = parseOutline(DEMO_OUTLINE);
    expect(layoutNodes(parsed.nodes, parsed.edges)).toEqual(parsed.nodes);
    expectNoOverlaps(parsed.nodes);
    const bounds = parsed.nodes.map((node) => ({ left: node.position.x, right: node.position.x + nodeSize(node).width }));
    expect(Math.max(...bounds.map((bound) => bound.right)) - Math.min(...bounds.map((bound) => bound.left))).toBeLessThan(1400);
    const spine = parsed.nodes.filter((node) => node.data.kind !== 'subtopic');
    expect(spine.every((node) => node.position.x + nodeSize(node).width / 2 === 0)).toBe(true);
    parsed.nodes.filter((node) => node.data.kind === 'topic').forEach((topic, index) => {
      const children = parsed.nodes.filter((node) => node.data.parentId === topic.id);
      expect(children.every((child) => index % 2 === 0 ? child.position.x > 0 : child.position.x + nodeSize(child).width < 0)).toBe(true);
    });
    expectRoutesClear(parsed.nodes, roadmapEdges(parsed.nodes, parsed.edges));
  });

  it('reserves measured heights and widths before placing subsequent sections', () => {
    const parsed = parseOutline(DEMO_OUTLINE);
    const measured = parsed.nodes.map((node, index) => ({
      ...node,
      measured: { width: index % 3 === 0 ? 370 : 255, height: index % 4 === 0 ? 320 : 95 },
    }));
    const laidOut = layoutNodes(measured, parsed.edges);
    expectNoOverlaps(laidOut);
    expect(laidOut[0].style?.width).toBe(370);
    expectRoutesClear(laidOut, roadmapEdges(laidOut, parsed.edges));
  });

  it('keeps every node visible with many topics, disconnected nodes, and cycles', () => {
    const parsed = parseOutline('# Chapter\n## Section\n' + Array.from({ length: 8 }, (_, index) => `### Topic ${index}\n- Detail ${index}`).join('\n'));
    const edges = [...parsed.edges,
      { id: 'cycle-a', source: parsed.nodes[3].id, target: parsed.nodes[2].id },
      { id: 'cycle-b', source: parsed.nodes[2].id, target: parsed.nodes[3].id },
    ];
    const arranged = layoutNodes(parsed.nodes, edges);
    expectNoOverlaps(arranged);
    expect(arranged.map((node) => node.id)).toEqual(parsed.nodes.map((node) => node.id));
    expect(arranged.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
    expect(layoutNodes([], [])).toEqual([]);
  });

  it('centers topics on unequal measured child stacks and aligns their inner edges', () => {
    const parsed = parseOutline('# Chapter\n## Section\n### First\n- Short\n- Tall equation\n- Final\n### Second\n- Fraction\n- Small');
    const measured = parsed.nodes.map((node, index) => ({ ...node, measured: { width: 300 + index * 11, height: index === 4 ? 210 : index === 8 ? 140 : 54 } }));
    const arranged = layoutNodes(measured, parsed.edges);
    for (const topic of arranged.filter((node) => node.data.kind === 'topic')) {
      const children = arranged.filter((node) => node.data.parentId === topic.id);
      const top = children[0].position.y;
      const last = children[children.length - 1];
      const bottom = last.position.y + nodeSize(last).height;
      expect(topic.position.y + nodeSize(topic).height / 2).toBeCloseTo((top + bottom) / 2);
      const innerEdges = children.map((node) => node.position.x > 0 ? node.position.x : node.position.x + nodeSize(node).width);
      expect(new Set(innerEdges).size).toBe(1);
      children.slice(1).forEach((node, index) => expect(node.position.y - children[index].position.y - nodeSize(children[index]).height).toBe(8));
    }
    expectNoOverlaps(arranged);
    expectRoutesClear(arranged, roadmapEdges(arranged, parsed.edges));
  });

  it('places the next section after every child in the previous section', () => {
    const parsed = parseOutline('# Chapter\n## First section\n### Topic\n- First\n- Long formula\n- Last\n## Second section\n### Next topic\n- Detail');
    const measured = parsed.nodes.map((node, index) => ({ ...node, measured: { width: 300, height: index === 4 ? 330 : 54 } }));
    const arranged = layoutNodes(measured, parsed.edges);
    const boundary = arranged.find((node) => node.data.label === 'Second section')!;
    for (const child of arranged.filter((node) => node.data.parentId === parsed.nodes[2].id)) {
      expect(child.position.y + nodeSize(child).height).toBeLessThan(boundary.position.y);
    }
    expect(arranged[8].position.y).toBeGreaterThan(boundary.position.y + nodeSize(boundary).height);
    expectRoutesClear(arranged, roadmapEdges(arranged, parsed.edges));
  });
});

describe('routeEdges', () => {
  it('routes the right and left stacks through their facing handles', () => {
    const parsed = parseOutline('# Chapter\n## Section\n### First topic\n- Right detail\n### Second topic\n- Left detail');
    const right = parsed.edges.find((edge) => edge.target === parsed.nodes[3].id)!;
    const left = parsed.edges.find((edge) => edge.target === parsed.nodes[5].id)!;
    expect([left.sourceHandle, left.targetHandle]).toEqual(['left', 'right']);
    expect([right.sourceHandle, right.targetHandle]).toEqual(['right', 'left']);
    const sectionEdge = parsed.edges.find((edge) => edge.target === parsed.nodes[1].id)!;
    expect([sectionEdge.sourceHandle, sectionEdge.targetHandle]).toEqual(['bottom', 'top']);
    expect(routeEdges(parsed.nodes, parsed.edges)).toEqual(parsed.edges);
  });

  it('preserves custom handles on unrelated connections', () => {
    const parsed = parseOutline('# Chapter\n## Section\n### Topic\n- Detail');
    const edges = [{ ...parsed.edges[0], sourceHandle: 'right', targetHandle: 'left' }];
    expect(routeEdges(parsed.nodes, edges)).toEqual(edges);
  });
});

describe('roadmapEdges', () => {
  it('connects consecutive spine items for display and retains the structural hierarchy', () => {
    const parsed = parseOutline('# Chapter\n## Section\n### First\n- Detail\n### Second\n- Other detail');
    const original = structuredClone(parsed.edges);
    const rendered = roadmapEdges(parsed.nodes, parsed.edges);
    expect(rendered.some((edge) => edge.source === parsed.nodes[2].id && edge.target === parsed.nodes[4].id)).toBe(true);
    expect(rendered.find((edge) => edge.target === parsed.nodes[3].id)?.style?.strokeDasharray).toBe('0.8 8');
    expect(rendered.find((edge) => edge.target === parsed.nodes[3].id)?.type).toBe('default');
    expect(rendered.find((edge) => edge.target === parsed.nodes[4].id)?.style?.strokeDasharray).toBe('0');
    expect(rendered.find((edge) => edge.target === parsed.nodes[4].id)?.type).toBe('straight');
    expect(rendered.every((edge) => edge.style?.stroke === '#2b78e4')).toBe(true);
    expect(parsed.edges).toEqual(original);
    expect(parsed.nodes[4].data.parentId).toBe(parsed.nodes[1].id);
    expectRoutesClear(parsed.nodes, rendered);
  });
});

describe('example chapter', () => {
  it('contains a complete, useful set of editable physics notes', () => {
    const chapter = createDemoChapter();
    expect(chapter.nodes).toHaveLength(25);
    expect(chapter.nodes.filter((node) => node.data.kind === 'section')).toHaveLength(2);
    expect(chapter.nodes.filter((node) => node.data.kind === 'topic')).toHaveLength(4);
    expect(chapter.nodes.every((node) => node.data.notes.length > 50)).toBe(true);
    expect(chapter.edges).toHaveLength(chapter.nodes.length - 1);
    const displacement = chapter.nodes.find((node) => node.data.label.startsWith('Displacement after time'))!;
    expect(displacement.data.notes).toContain(String.raw`$\Delta x = ut + \frac{1}{2}at^2$`);
    for (const node of chapter.nodes) {
      expect(node.data.notes).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
      expect(node.data.notes).not.toMatch(/(?<!\\)Delta [xv]/);
    }
  });
});
