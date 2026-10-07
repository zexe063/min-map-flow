import { getBezierPath, getStraightPath, Position } from '@xyflow/react';
import type { RefObject } from 'react';
import MathText from './MathText';
import RoadmapTails, { roadmapTails } from './RoadmapTails';
import { nodeSize } from '../lib/layout';
import type { Chapter, MapEdge, MapNode } from '../types';

const handlePosition: Record<string, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

export default function ExportStage({ chapter, edges, stageRef, language }: {
  chapter: Chapter; edges: MapEdge[]; stageRef: RefObject<HTMLDivElement | null>; language: 'en' | 'hi';
}) {
  // The PDF supplies the margins; retain only room for the line caps.
  const padding = 8;
  const tails = roadmapTails(chapter.nodes);
  const left = chapter.nodes.length ? Math.min(...chapter.nodes.map(node => node.position.x)) : 0;
  const top = chapter.nodes.length ? Math.min(...chapter.nodes.map(node => node.position.y), ...tails.map(line => line.y1)) : 0;
  const right = chapter.nodes.length ? Math.max(...chapter.nodes.map(node => node.position.x + nodeSize(node).width)) : 1;
  const bottom = chapter.nodes.length ? Math.max(...chapter.nodes.map(node => node.position.y + nodeSize(node).height), ...tails.map(line => line.y2)) : 1;
  const width = Math.ceil(right - left + padding * 2);
  const height = Math.ceil(bottom - top + padding * 2);
  const offsetX = padding - left, offsetY = padding - top;
  const nodes = new Map(chapter.nodes.map(node => [node.id, node]));

  const anchor = (node: MapNode, handle: string | null | undefined, source: boolean) => {
    const size = nodeSize(node), x = node.position.x + offsetX, y = node.position.y + offsetY;
    if (handle === 'left') return { x, y: y + size.height / 2 };
    if (handle === 'right') return { x: x + size.width, y: y + size.height / 2 };
    if (handle === 'top' || (!source && handle !== 'bottom')) return { x: x + size.width / 2, y };
    return { x: x + size.width / 2, y: y + size.height };
  };

  return <div className="export-stage-holder" aria-hidden="true">
    <div ref={stageRef} className="export-stage" lang={language} style={{ width, height }}>
      <svg width={width} height={height} className="export-edges" xmlns="http://www.w3.org/2000/svg">
        <g transform={`translate(${offsetX}, ${offsetY})`}><RoadmapTails nodes={chapter.nodes} /></g>
        {edges.map(edge => {
          const source = nodes.get(edge.source), target = nodes.get(edge.target);
          if (!source || !target) return null;
          const from = anchor(source, edge.sourceHandle, true), to = anchor(target, edge.targetHandle, false);
          const coordinates = { sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y };
          const [path] = edge.type === 'straight' ? getStraightPath(coordinates) : getBezierPath({ ...coordinates,
            sourcePosition: handlePosition[edge.sourceHandle ?? ''] ?? Position.Bottom,
            targetPosition: handlePosition[edge.targetHandle ?? ''] ?? Position.Top });
          return <path key={edge.id} d={path} fill="none" stroke={edge.style?.stroke ?? '#2b78e4'} strokeWidth={edge.style?.strokeWidth ?? 3} strokeDasharray={edge.style?.strokeDasharray} strokeLinecap="round" />;
        })}
      </svg>
      {chapter.nodes.map(node => <div key={node.id} data-export-node={node.id}
        className={`export-card chapter-node chapter-node--${node.data.kind}`} data-kind={node.data.kind}
        style={{ left: node.position.x + offsetX, top: node.position.y + offsetY, width: nodeSize(node).width, minHeight: nodeSize(node).height }}>
        <MathText text={node.data.label} className="chapter-node-label" />
      </div>)}
    </div>
  </div>;
}
