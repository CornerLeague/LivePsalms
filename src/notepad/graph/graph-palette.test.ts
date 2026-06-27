import { describe, it, expect } from 'vitest';
import { resolveGraphPalette, GRAPH_NODE_COLORS_LIGHT } from './graph-palette';

describe('resolveGraphPalette', () => {
  it('falls back to light defaults when vars are empty (jsdom/tests)', () => {
    const p = resolveGraphPalette(() => '');
    expect(p.nodeColors.scripture).toBe(GRAPH_NODE_COLORS_LIGHT.scripture);
    expect(p.edge).toBe('rgba(168, 160, 145, 1)');
    expect(p.label).toBe('rgba(62, 50, 40, 1)');
  });

  it('reads provided CSS var values when present', () => {
    const vars: Record<string, string> = {
      '--graph-node-scripture': '#d8c4a8',
      '--graph-edge': 'rgba(120, 116, 108, 1)',
      '--graph-label': 'rgba(239, 237, 238, 1)',
    };
    const p = resolveGraphPalette((n) => vars[n] ?? '');
    expect(p.nodeColors.scripture).toBe('#d8c4a8');
    expect(p.edge).toBe('rgba(120, 116, 108, 1)');
    expect(p.label).toBe('rgba(239, 237, 238, 1)');
  });
});
