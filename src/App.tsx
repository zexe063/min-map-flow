import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Controls, ConnectionMode, applyNodeChanges,
  useNodesInitialized, useReactFlow, ViewportPortal, type NodeChange, type Viewport,
} from '@xyflow/react';
import { Box, Check, LoaderCircle, AlignLeft, Download } from 'lucide-react';
import ChapterNode from './components/ChapterNode';
import ExportStage from './components/ExportStage';
import RoadmapTails from './components/RoadmapTails';
import { parseOutline } from './lib/outline';
import { layoutNodes, nodeSize, roadmapEdges } from './lib/layout';
import { createDemoChapter } from './lib/demo';
import { LIBRARY_STORAGE_KEY, parseLibraryJSON, saveLibrary } from './lib/storage';
import type { Chapter, ChapterLibrary, MapNode } from './types';

const nodeTypes = { chapter: ChapterNode };
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
const LANGUAGE_STORAGE_KEY = 'chaptermap.language';
const LAYOUT_VERSION = 5;
type TextLanguage = 'en' | 'hi';

function initialLanguage(): TextLanguage {
  try { return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'hi' ? 'hi' : 'en'; }
  catch { return 'en'; }
}

function initialState(): { library: ChapterLibrary; storageError: string } {
  let storageError = '';
  try {
    const saved = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (saved) return { library: parseLibraryJSON(saved), storageError };
  } catch {
    // Leave unreadable data intact instead of replacing it with the sample.
    storageError = 'The previous saved map could not be read. Your stored data has been kept; automatic saving is paused.';
  }
  const chapter = createDemoChapter();
  return { library: { version: 1, activeId: chapter.id, chapters: [chapter] }, storageError };
}

export default function App() {
  return <ReactFlowProvider><TextToRoadmap /></ReactFlowProvider>;
}

function TextToRoadmap() {
  const [language, setLanguage] = useState(initialLanguage);
  const [initial] = useState(initialState);
  const [library, setLibrary] = useState(initial.library);
  const chapter = library.chapters.find(item => item.id === library.activeId)!;
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState(initial.storageError);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [needsLayout, setNeedsLayout] = useState(chapter.layoutVersion !== LAYOUT_VERSION);
  const canvasRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef(chapter);
  currentRef.current = chapter;
  const initialized = useNodesInitialized();
  const { getNodes, setViewport } = useReactFlow<MapNode>();
  const draft = chapter.draftOutline ?? chapter.outline;
  const dirty = chapter.draftOutline !== undefined && chapter.draftOutline !== chapter.outline;
  const displayEdges = useMemo(() => roadmapEdges(chapter.nodes, chapter.edges), [chapter.nodes, chapter.edges]);

  useLayoutEffect(() => {
    document.documentElement.dataset.language = language;
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, language); }
    catch { /* The switch still works when browser storage is unavailable. */ }
  }, [language]);

  const changeLanguage = (next: TextLanguage) => {
    if (next === language) return;
    setLanguage(next);
    setNeedsLayout(true);
  };

  const updateChapter = useCallback((update: (previous: Chapter) => Chapter) => {
    setLibrary(previous => ({
      ...previous,
      chapters: previous.chapters.map(item => item.id === previous.activeId
        ? { ...update(item), updatedAt: Date.now() }
        : item),
    }));
  }, []);

  useEffect(() => {
    if (initial.storageError) return;
    setSaved(false);
    const timer = window.setTimeout(() => {
      try { saveLibrary(library); setSaved(true); setSaveError(''); }
      catch (failure) { setSaveError(`Could not save in this browser. ${messageOf(failure)}`); }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [library, initial.storageError]);

  const showStart = useCallback((nodes: MapNode[]) => {
    const canvas = canvasRef.current;
    if (!canvas || !nodes.length) return;
    const left = Math.min(...nodes.map(node => node.position.x));
    const right = Math.max(...nodes.map(node => node.position.x + nodeSize(node).width));
    const top = Math.min(...nodes.map(node => node.position.y));
    const zoom = Math.max(0.12, Math.min(1, (canvas.clientWidth - 100) / (right - left + 30)));
    void setViewport({ x: (canvas.clientWidth - (right - left) * zoom) / 2 - left * zoom, y: 135 - top * zoom, zoom }, { duration: 0 });
  }, [setViewport]);

  useEffect(() => {
    if (!initialized || !needsLayout) return;
    let cancelled = false;
    let timer: number | undefined;
    const family = language === 'hi' ? 'Noto Sans Devanagari' : 'Balsamiq Sans';
    const weight = language === 'hi' ? 700 : 400;
    void document.fonts.load(`${weight} 17px "${family}"`).then(() => document.fonts.ready).then(() => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        const live = new Map(getNodes().map(node => [node.id, node]));
        const current = currentRef.current;
        const nodes = layoutNodes(current.nodes.map(node => ({ ...node, measured: live.get(node.id)?.measured ?? node.measured })), current.edges);
        updateChapter(previous => ({ ...previous, nodes, layoutVersion: LAYOUT_VERSION }));
        setNeedsLayout(false);
        showStart(nodes);
      }, 120);
    }).catch(() => {
      if (cancelled) return;
      setError('The selected font could not load. Please refresh to try again.');
      setNeedsLayout(false);
    });
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [initialized, needsLayout, generation, language, getNodes, showStart, updateChapter]);

  const onNodesChange = useCallback((changes: NodeChange<MapNode>[]) => {
    // Dimensions and manual positions never replace text waiting to be generated.
    const allowed = changes.filter(change => change.type !== 'remove');
    updateChapter(previous => ({ ...previous, nodes: applyNodeChanges(allowed, previous.nodes) }));
  }, [updateChapter]);

  const generate = () => {
    try {
      const graph = parseOutline(draft);
      if (graph.title.length > 300) throw new Error('Keep the roadmap title under 300 characters.');
      if (graph.nodes.some(node => node.data.label.length > 12_000)) throw new Error('A single card is too long. Split it into smaller points.');
      updateChapter(previous => ({
        ...previous, title: graph.title, outline: draft, draftOutline: undefined,
        nodes: graph.nodes, edges: graph.edges, viewport: undefined, layoutVersion: LAYOUT_VERSION,
      }));
      setError(''); setNeedsLayout(true); setGeneration(value => value + 1);
    } catch (failure) { setError(messageOf(failure)); }
  };

  const downloadMap = async () => {
    if (!stageRef.current) return;
    setExporting(true); setError('');
    try {
      const { downloadDiagramPDF } = await import('./lib/export');
      await downloadDiagramPDF(stageRef.current, chapter.title);
    } catch (failure) { setError(`Could not export the map: ${messageOf(failure)}`); }
    finally { setExporting(false); }
  };

  const rememberViewport = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    updateChapter(previous => ({ ...previous, viewport }));
  }, [updateChapter]);

  return <div className="app-shell">
    <div className="editor-layout">
      <aside className="text-sidebar" aria-label="Text to roadmap">
        <div className="sidebar-tab"><AlignLeft size={19} strokeWidth={1.8} />Text to roadmap</div>
        <section className="syntax-panel" aria-labelledby="text-heading">
          <div className="language-toolbar">
            <span>Text language</span>
            <div className="language-switch" role="group" aria-label="Text language">
              <button type="button" lang="en" aria-pressed={language === 'en'} disabled={exporting}
                onClick={() => changeLanguage('en')}>English</button>
              <button type="button" lang="hi" aria-pressed={language === 'hi'} disabled={exporting}
                onClick={() => changeLanguage('hi')}>हिन्दी</button>
            </div>
          </div>
          <h1 id="text-heading">Generate Roadmap from Text</h1>
          <p>Write a single topic on each line. Starting characters decide the type of each node.</p>
          <div className="syntax-row"><code className="marker-dark"># Roadmap Title</code><span>The title</span></div>
          <div className="syntax-row"><code className="marker-dark">## Parent Label</code><span>A section label</span></div>
          <div className="syntax-row"><code className="marker-topic">### Parent Topic</code><span>A main topic</span></div>
          <div className="syntax-row"><code className="marker-subtopic">- Subtopic</code><span>A subtopic</span></div>
          <p className="formula-hint">Math: <code>$x^2$</code> or <code>{'$$\\frac{a}{b}$$'}</code></p>
          <label htmlFor="roadmap-text">Start writing below:</label>
        </section>
        <textarea id="roadmap-text" aria-label="Roadmap text" className="roadmap-input" lang={language}
          value={draft} onChange={event => { updateChapter(previous => ({ ...previous, draftOutline: event.target.value })); setError(''); }}
          placeholder={'# Roadmap Title\n## Parent Label\n### Parent Topic\n- Subtopic\n- Formula: $E = mc^2$'}
          spellCheck={false} maxLength={150_000} />
        {(error || saveError) && <p className="editor-error" role="alert">{error || saveError}</p>}
        <div className="sidebar-footer">
          <button className="generate-button" onClick={generate}><Box size={21} />Generate Roadmap</button>
          <span className="save-state" role="status">{dirty ? 'Text changed — generate to update the map' : saved ? <><Check size={12} />Saved in this browser</> : 'Saving…'}</span>
        </div>
      </aside>
      <main className="diagram-canvas" ref={canvasRef} aria-label="Roadmap diagram" lang={language}>
        <ReactFlow<MapNode> key={`${chapter.id}-${generation}`}
          nodes={chapter.nodes} edges={displayEdges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onMoveEnd={rememberViewport}
          defaultViewport={chapter.viewport} fitView={!chapter.viewport} fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          nodesConnectable={false} edgesReconnectable={false} connectionMode={ConnectionMode.Loose}
          deleteKeyCode={null} minZoom={0.05} maxZoom={2} onlyRenderVisibleElements={false}
          defaultEdgeOptions={{ type: 'default' }}>
          <Controls showInteractive={false} position="bottom-left" fitViewOptions={{ padding: 0.2, maxZoom: 1 }} />
          <ViewportPortal><svg className="roadmap-tails" width="1" height="1"><RoadmapTails nodes={chapter.nodes} /></svg></ViewportPortal>
        </ReactFlow>
        <button className="pdf-button" onClick={() => void downloadMap()} disabled={exporting || needsLayout || !initialized || !chapter.nodes.length}>
          {exporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
          {exporting ? 'Preparing PDF…' : 'Download PDF'}
        </button>
      </main>
    </div>
    <ExportStage chapter={chapter} edges={displayEdges} stageRef={stageRef} language={language} />
  </div>;
}
