export type GraphNodeType = 'scripture' | 'sermon' | 'devotion' | 'theme' | 'general';

export interface GraphPalette {
  nodeColors: Record<GraphNodeType, string>;
  edge: string;
  label: string;
}

// Current (light) node hues — also the fallback when CSS vars are unavailable.
export const GRAPH_NODE_COLORS_LIGHT: Record<GraphNodeType, string> = {
  scripture: '#C49A78',
  sermon: '#7A9BAE',
  devotion: '#6B8B7A',
  theme: '#D4A0A0',
  general: '#9E9484',
};

const EDGE_LIGHT = 'rgba(168, 160, 145, 1)';
const LABEL_LIGHT = 'rgba(62, 50, 40, 1)';

const VAR: Record<GraphNodeType, string> = {
  scripture: '--graph-node-scripture',
  sermon: '--graph-node-sermon',
  devotion: '--graph-node-devotion',
  theme: '--graph-node-theme',
  general: '--graph-node-general',
};

/**
 * Resolve the graph palette from CSS custom properties so the canvas tracks the
 * theme. `read` returns a computed property value (or '' if undefined). Any var
 * that reads empty falls back to the light default — so tests with structural
 * canvas mocks (no real computed styles) keep today's colors.
 */
export function resolveGraphPalette(read: (name: string) => string): GraphPalette {
  const pick = (v: string, fallback: string) => {
    const s = v.trim();
    return s.length > 0 ? s : fallback;
  };
  const nodeColors = (Object.keys(VAR) as GraphNodeType[]).reduce((acc, k) => {
    acc[k] = pick(read(VAR[k]), GRAPH_NODE_COLORS_LIGHT[k]);
    return acc;
  }, {} as Record<GraphNodeType, string>);
  return {
    nodeColors,
    edge: pick(read('--graph-edge'), EDGE_LIGHT),
    label: pick(read('--graph-label'), LABEL_LIGHT),
  };
}
