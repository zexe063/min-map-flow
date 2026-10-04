import { nodeSize } from '../lib/layout';
import type { MapNode } from '../types';

export function roadmapTails(nodes: MapNode[]) {
  const spine = nodes.filter(node => node.data.kind !== 'subtopic');
  const first = spine[0];
  const last = spine.filter(node => node.data.kind === 'topic').at(-1) ?? spine.at(-1);
  if (!first || !last) return [];
  const end = last.position.y + nodeSize(last).height;
  return [
    { id: 'start', x: first.position.x + nodeSize(first).width / 2, y1: first.position.y - 100, y2: first.position.y },
    { id: 'end', x: last.position.x + nodeSize(last).width / 2, y1: end, y2: end + 100 },
  ];
}

export default function RoadmapTails({ nodes }: { nodes: MapNode[] }) {
  return <g stroke="#2b78e4" strokeWidth={3.5} strokeDasharray="0.8 8" strokeLinecap="round">
    {roadmapTails(nodes).map(line => <line key={line.id} data-roadmap-terminal={line.id} x1={line.x} x2={line.x} y1={line.y1} y2={line.y2} />)}
  </g>;
}
