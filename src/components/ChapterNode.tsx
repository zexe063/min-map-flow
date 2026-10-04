import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { MapNode } from '../types';
import MathText from './MathText';
import './math-components.css';

const handles = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
] as const;

function ChapterNode({ data, selected }: NodeProps<MapNode>) {
  return (
    <div className={`chapter-node chapter-node--${data.kind}${selected ? ' is-selected' : ''}`} data-kind={data.kind}>
      {handles.map(([id, position]) => (
        <Handle key={id} id={id} type="source" position={position} isConnectable={false} />
      ))}
      <MathText text={data.label || 'Untitled topic'} className="chapter-node-label" />
    </div>
  );
}

export default memo(ChapterNode);
