const POLL_INTERVAL_MS = 120;
const MAX_POLLS = 17; // ~2s budget (spec §6), counted in polls so fake timers stay deterministic

interface SimpleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectOf(el: Element): SimpleRect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function isZero(rect: SimpleRect): boolean {
  return rect.x === 0 && rect.y === 0 && rect.width === 0 && rect.height === 0;
}

function isStable(a: SimpleRect, b: SimpleRect): boolean {
  return (
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

/**
 * Poll for `[data-tour="<token>"]` until it exists, has a non-zero rect
 * (all-zero = jsdom/undisplayed — same guard as the old tour's readRect), and
 * the rect is stable across two consecutive polls (lets panels a prepare
 * opened finish their own animations before we measure — spec §4). Resolves
 * null when the ~2s budget runs out or `signal` aborts.
 */
export function resolveAnchor(token: string, signal: AbortSignal): Promise<Element | null> {
  return new Promise((resolve) => {
    let lastRect: SimpleRect | null = null;
    let lastEl: Element | null = null;
    let polls = 0;
    let settled = false;

    const finish = (value: Element | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish(null);
    if (signal.aborted) {
      resolve(null);
      return;
    }
    signal.addEventListener('abort', onAbort);

    const poll = () => {
      if (settled) return;
      const el = document.querySelector(`[data-tour="${token}"]`);
      if (el) {
        const rect = rectOf(el);
        if (!isZero(rect)) {
          if (el === lastEl && lastRect && isStable(rect, lastRect)) {
            finish(el);
            return;
          }
          lastEl = el;
          lastRect = rect;
        } else {
          lastEl = null;
          lastRect = null;
        }
      } else {
        lastEl = null;
        lastRect = null;
      }
      polls += 1;
      if (polls >= MAX_POLLS) {
        finish(null);
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
  });
}
