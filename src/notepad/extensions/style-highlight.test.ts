import { describe, it, expect } from 'vitest';
import { highlightBackgroundStyle, nextHighlightAction } from './style-highlight';

describe('highlightBackgroundStyle', () => {
  it('tiles the swatch texture at a consistent scale so highlights flow across words and lines', () => {
    const style = highlightBackgroundStyle('/styles/highlight/highlight-60.webp');
    expect(style).toContain('background-image:url(/styles/highlight/highlight-60.webp)');
    expect(style).toContain('background-size:cover');
    expect(style).toContain('background-position:center');
    expect(style).toContain('box-decoration-break:clone');
  });

  it('returns an empty string for a missing url', () => {
    expect(highlightBackgroundStyle(undefined)).toBe('');
  });
});

describe('nextHighlightAction', () => {
  it('returns unset when a highlight is active', () => {
    expect(nextHighlightAction(true, 'highlight-02', 'highlight-01')).toEqual({ type: 'unset' });
  });
  it('sets the last-used swatch when inactive', () => {
    expect(nextHighlightAction(false, 'highlight-02', 'highlight-01')).toEqual({ type: 'set', swatchId: 'highlight-02' });
  });
  it('falls back to the default swatch when none used yet', () => {
    expect(nextHighlightAction(false, null, 'highlight-01')).toEqual({ type: 'set', swatchId: 'highlight-01' });
  });
  it('returns none when neither last-used nor default exists', () => {
    expect(nextHighlightAction(false, null, null)).toEqual({ type: 'none' });
  });
});
