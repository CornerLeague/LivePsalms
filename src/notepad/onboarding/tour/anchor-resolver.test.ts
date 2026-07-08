// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAnchor } from './anchor-resolver';

function mountAnchor(
  token: string,
  rect: { x: number; y: number; width: number; height: number },
): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-tour', token);
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe('resolveAnchor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('resolves an element once its rect is non-zero and stable across two polls', async () => {
    const el = mountAnchor('present', { x: 10, y: 20, width: 100, height: 40 });
    const pending = resolveAnchor('present', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBe(el);
  });

  it('resolves null when the token never appears within the ~2s budget', async () => {
    const pending = resolveAnchor('never', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(pending).resolves.toBeNull();
  });

  it('treats an all-zero rect as missing (jsdom-safe guard, like the old readRect)', async () => {
    mountAnchor('zero', { x: 0, y: 0, width: 0, height: 0 });
    const pending = resolveAnchor('zero', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(pending).resolves.toBeNull();
  });

  it('resolves null immediately on abort', async () => {
    const controller = new AbortController();
    const pending = resolveAnchor('whatever', controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeNull();
  });
});
