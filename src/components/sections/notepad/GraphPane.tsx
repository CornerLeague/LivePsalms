import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BookOpen, Mic, PenLine, Sparkles, FileText, Maximize2, Minimize2, Settings2 } from 'lucide-react';
import { useNoteCollection } from '@/notepad/context/useNoteCollection';
import { useReferenceGraph } from '@/notepad/context/useReferenceGraph';
import { projectGraph } from '@/notepad/graph/project-graph';
import {
  GraphView,
  DEFAULT_FILTERS,
  DEFAULT_SETTINGS,
  type NodeTypeFilters,
  type GraphSettings,
} from '@/notepad/graph/graph-view';
import type { GraphNode } from '@/notepad/graph/types';
import { emitOnboardingEvent } from '@/notepad/onboarding/onboarding-events';

const NODE_COLORS: Record<string, string> = {
  scripture: '#C49A78',
  sermon: '#7A9BAE',
  devotion: '#6B8B7A',
  theme: '#D4A0A0',
  general: '#9E9484',
};

const NODE_ICONS: Record<string, typeof BookOpen> = {
  scripture: BookOpen,
  sermon: Mic,
  devotion: PenLine,
  theme: Sparkles,
  general: FileText,
};

interface GraphPaneProps {
  graphOpen: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /**
   * Render for an embedded context (e.g. the mobile "More" sheet) instead of the
   * desktop right-hand sidebar. Drops the `hidden md:flex` breakpoint hiding and
   * the desktop flex/opacity sizing so the graph fills its parent on small screens.
   */
  embedded?: boolean;
  /** Mobile/embedded only: route node taps to a peek view instead of opening the note / popover. */
  onNodePeek?: (node: { id: string; type: GraphNode['type']; title: string }) => void;
  /** Mobile/embedded only: center local mode on this node id (e.g. from a peek "Focus" action). */
  focusNodeId?: string | null;
}

export function GraphPane({ graphOpen, expanded = false, onToggleExpand, embedded = false, onNodePeek, focusNodeId = null }: GraphPaneProps) {
  const { notes, activeNoteId, collection } = useNoteCollection();
  const { references, scriptureNodes, graph } = useReferenceGraph();
  const openNote = collection.openNote;

  const { nodes, edges } = useMemo(
    () => projectGraph(notes, references, scriptureNodes),
    [notes, references, scriptureNodes],
  );

  // Kept in a ref so the memoized GraphView stays stable while always seeing the
  // latest callback. onNodeTap returns true (handled) only when a peek handler exists.
  const onNodePeekRef = useRef(onNodePeek);
  onNodePeekRef.current = onNodePeek;

  const view = useMemo(() => new GraphView({
    onNodeOpen: (id) => openNote(id),
    devicePixelRatio: () => window.devicePixelRatio || 1,
    prefersReducedMotion: () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    onNodeTap: (n) => {
      const cb = onNodePeekRef.current;
      if (cb) { cb(n); return true; }
      return false;
    },
  }), [openNote]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Onboarding: emit 'graph-visited' exactly once, the first time the graph is
  // actually shown (desktop: graphOpen toggles true; embedded: the mobile sheet
  // only mounts this component when opened). Ref-guarded so re-renders never spam.
  const graphVisitedRef = useRef(false);
  useEffect(() => {
    if (graphVisitedRef.current) return;
    if (!(embedded || graphOpen)) return;
    graphVisitedRef.current = true;
    emitOnboardingEvent('graph-visited');
  }, [embedded, graphOpen]);

  // Attach / detach
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    view.attach(canvasRef.current, containerRef.current);
    return () => view.detach();
  }, [view]);

  // Forward neighborhood lookup
  useEffect(() => {
    view.setNeighborhoodFn(graph.getNeighborhood);
  }, [view, graph.getNeighborhood]);

  // Forward data
  useEffect(() => {
    view.setData(nodes, edges, activeNoteId);
  }, [view, nodes, edges, activeNoteId]);

  // Controls — React state, forwarded into the view on each change.
  const [graphMode, setGraphMode] = useState<'global' | 'local'>('global');
  const [filters, setFilters] = useState<NodeTypeFilters>(DEFAULT_FILTERS);
  const [settings, setSettings] = useState<GraphSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => { view.setMode(graphMode); }, [view, graphMode]);
  useEffect(() => { view.setFilters(filters); }, [view, filters]);
  useEffect(() => { view.setSettings(settings); }, [view, settings]);
  useEffect(() => {
    view.setFocus(focusNodeId);
    if (focusNodeId) setGraphMode('local');
  }, [view, focusNodeId]);

  // Popover state subscribed via useSyncExternalStore.
  const state = useSyncExternalStore(view.subscribe, view.getSnapshot);
  const popover = state.popover;

  const toggleFilter = (key: keyof NodeTypeFilters) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <aside
      className={
        embedded
          ? 'overflow-hidden flex flex-col h-full'
          : 'overflow-hidden border-l flex-col hidden md:flex'
      }
      style={
        embedded
          ? // A definite height is required so the flex-1 canvas container below
            // resolves to a real size — the sheet parent is height-indefinite, so
            // `h-full` alone would collapse the canvas to 0 and draw nothing.
            { background: 'color-mix(in srgb, var(--plaster) 40%, transparent)', minHeight: '60vh' }
          : {
              flex: expanded ? '1 1 0%' : graphOpen ? '0 0 35%' : '0 0 0px',
              borderColor: graphOpen ? 'var(--pale-stone)' : 'transparent',
              background: 'color-mix(in srgb, var(--plaster) 40%, transparent)',
              opacity: graphOpen ? 1 : 0,
              transition: 'flex 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
            }
      }
    >
      <div className="p-4 space-y-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md overflow-hidden" style={{ border: '1px solid var(--pale-stone)' }}>
            <button onClick={() => setGraphMode('global')} className="px-3 py-1.5 text-[10px] font-medium tracking-wider"
              style={{ background: graphMode === 'global' ? 'color-mix(in srgb, var(--warm-sand) 35%, transparent)' : 'transparent', color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}>
              Global
            </button>
            <button onClick={() => setGraphMode('local')} className="px-3 py-1.5 text-[10px] font-medium tracking-wider"
              style={{ background: graphMode === 'local' ? 'color-mix(in srgb, var(--warm-sand) 35%, transparent)' : 'transparent', color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}>
              Local
            </button>
          </div>
          <button onClick={() => setSettingsOpen(!settingsOpen)} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors" title="Graph settings">
            <Settings2 className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(filters) as Array<keyof NodeTypeFilters>).map((key) => {
            const Icon = NODE_ICONS[key];
            return (
              <button key={key} onClick={() => toggleFilter(key)} className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium tracking-wider transition-all"
                style={{
                  border: `1px solid ${filters[key] ? NODE_COLORS[key] : 'var(--pale-stone)'}`,
                  background: filters[key] ? `${NODE_COLORS[key]}15` : 'transparent',
                  color: filters[key] ? NODE_COLORS[key] : 'var(--silica)',
                  fontFamily: 'Outfit, sans-serif',
                }}>
                <Icon className="w-3 h-3" />
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            );
          })}
        </div>

        {settingsOpen && (
          <div className="space-y-2 pt-2" style={{ borderTop: '1px solid var(--pale-stone)' }}>
            {graphMode === 'local' && (
              <SettingRow label="Depth" min={1} max={3} step={1} value={settings.depth}
                onChange={(v) => setSettings((s) => ({ ...s, depth: v }))} format={(v) => String(v)} />
            )}
            <SettingRow label="Node Size" min={0.5} max={2} step={0.1} value={settings.nodeSize}
              onChange={(v) => setSettings((s) => ({ ...s, nodeSize: v }))} format={(v) => `${v.toFixed(1)}x`} />
            <SettingRow label="Edge Width" min={0.5} max={3} step={0.1} value={settings.edgeThickness}
              onChange={(v) => setSettings((s) => ({ ...s, edgeThickness: v }))} format={(v) => `${v.toFixed(1)}x`} />
            <SettingRow label="Link Distance" min={60} max={300} step={10} value={settings.linkDistance}
              onChange={(v) => setSettings((s) => ({ ...s, linkDistance: v }))} format={(v) => String(v)} />
            <SettingRow label="Link Force" min={0.001} max={0.01} step={0.001} value={settings.linkForce}
              onChange={(v) => setSettings((s) => ({ ...s, linkForce: v }))} format={(v) => v.toFixed(3)} />
            <SettingRow label="Repel Force" min={100} max={2000} step={50} value={settings.repelForce}
              onChange={(v) => setSettings((s) => ({ ...s, repelForce: v }))} format={(v) => String(v)} />
            <button onClick={() => setSettings(DEFAULT_SETTINGS)}
              className="text-[10px] font-medium tracking-wider px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
              Reset Defaults
            </button>
          </div>
        )}
      </div>

      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => view.handleMouseDown(e)}
          onPointerMove={(e) => view.handleMouseMove(e)}
          onPointerUp={(e) => view.handleMouseUp(e)}
          onPointerLeave={() => view.handleMouseLeave()}
        />
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none">
            <p className="text-[11px] tracking-wider text-center" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
              Create notes with [[links]] or Bible verse references to see your knowledge graph.
            </p>
          </div>
        )}
        {graphMode === 'local' && !activeNoteId && !focusNodeId && (
          <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none">
            <p className="text-[11px] tracking-wider text-center" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
              Select a note to see its local graph.
            </p>
          </div>
        )}
        {popover && (
          <div
            className="absolute z-10 max-w-[250px] p-3 rounded-md shadow-lg pointer-events-none"
            style={{
              left: 0, top: 0,
              transform: `translate(calc(${popover.screenX}px - 50%), calc(${popover.screenY}px - 100% - 14px))`,
              background: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid color-mix(in srgb, var(--warm-sand) 50%, transparent)',
              fontFamily: 'Outfit, sans-serif',
            }}
          >
            <div className="text-[12px] font-bold mb-1" style={{ color: 'rgba(62, 50, 40, 1)' }}>{popover.title}</div>
            <div className="text-[11px]" style={{ color: 'rgba(62, 50, 40, 0.8)' }}>{popover.text}</div>
            <div className="text-[9px] mt-1" style={{ color: 'rgba(62, 50, 40, 0.5)' }}>{popover.translation}</div>
          </div>
        )}
      </div>

      {!embedded && (
        <div className="p-4 shrink-0" style={{ borderTop: '1px solid color-mix(in srgb, var(--pale-stone) 50%, transparent)' }}>
          <button onClick={onToggleExpand} className="flex items-center gap-2 w-full justify-center py-2 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
            {expanded
              ? <Minimize2 className="w-3.5 h-3.5" style={{ color: 'var(--deep-umber)' }} />
              : <Maximize2 className="w-3.5 h-3.5" style={{ color: 'var(--deep-umber)' }} />}
            <span className="text-[10px] font-medium tracking-widest" style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}>
              {expanded ? 'COLLAPSE' : 'EXPAND'}
            </span>
          </button>
        </div>
      )}
    </aside>
  );
}

function SettingRow(props: {
  label: string;
  min: number; max: number; step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] font-medium tracking-wider w-24 shrink-0"
        style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>{props.label}</label>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))} className="flex-1 h-1 accent-[#C49A78]" />
      <span className="text-[10px] w-10 text-right" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
        {props.format(props.value)}
      </span>
    </div>
  );
}
