import { describe, it, expect } from 'vitest';
import {
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
  isTextSize,
  nextTextSize,
  TEXT_SIZE_LABEL,
  TEXT_SIZE_SCALE,
} from './text-size-types';

describe('text-size-types', () => {
  it('exposes the three sizes in cycle order', () => {
    expect(TEXT_SIZES).toEqual(['base', 'large', 'xlarge']);
  });

  it('defaults to base', () => {
    expect(DEFAULT_TEXT_SIZE).toBe('base');
  });

  it('guards unknown values', () => {
    expect(isTextSize('large')).toBe(true);
    expect(isTextSize('huge')).toBe(false);
    expect(isTextSize(null)).toBe(false);
    expect(isTextSize(undefined)).toBe(false);
  });

  it('cycles base -> large -> xlarge -> base', () => {
    expect(nextTextSize('base')).toBe('large');
    expect(nextTextSize('large')).toBe('xlarge');
    expect(nextTextSize('xlarge')).toBe('base');
  });

  it('has a human label for every size', () => {
    expect(TEXT_SIZE_LABEL.base).toBe('A');
    expect(TEXT_SIZE_LABEL.large).toBe('A+');
    expect(TEXT_SIZE_LABEL.xlarge).toBe('A++');
  });

  it('has an ascending scale factor for every size, shared by both surfaces', () => {
    expect(TEXT_SIZE_SCALE.base).toBe(1);
    expect(TEXT_SIZE_SCALE.large).toBeGreaterThan(TEXT_SIZE_SCALE.base);
    expect(TEXT_SIZE_SCALE.xlarge).toBeGreaterThan(TEXT_SIZE_SCALE.large);
  });
});
