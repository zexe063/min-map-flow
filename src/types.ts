import type { Edge, Node, Viewport } from '@xyflow/react';

export type NodeKind = 'title' | 'section' | 'topic' | 'subtopic';

export type TopicData = {
  label: string;
  kind: NodeKind;
  notes: string;
  parentId?: string;
  [key: string]: unknown;
};

export type MapNode = Node<TopicData, 'chapter'>;
export type MapEdge = Edge;

export interface Chapter {
  id: string;
  title: string;
  outline: string;
  draftOutline?: string;
  layoutVersion?: number;
  nodes: MapNode[];
  edges: MapEdge[];
  viewport?: Viewport;
  updatedAt: number;
}

export interface ChapterLibrary {
  version: 1;
  activeId: string;
  chapters: Chapter[];
}
