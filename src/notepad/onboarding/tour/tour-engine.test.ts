import { describe, expect, it, vi } from 'vitest';
import { createTourEngine, type TourEngineDeps, type TourStep } from './tour-engine';

function makeStep(overrides: Partial<TourStep> & { id: string }): TourStep {
  return {
    placement: 'bottom',
    copy: { title: overrides.id, body: 'body' },
    anchor: () => null,
    ...overrides,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeDeps(steps: TourStep[], overrides: Partial<TourEngineDeps> = {}): TourEngineDeps {
  return {
    steps,
    initialViewport: 'desktop',
    getControls: () => ({}),
    resolveAnchor: vi.fn(async () => document.createElement('div')),
    onComplete: vi.fn(),
    onSkip: vi.fn(),
    onStepSkipped: vi.fn(),
    ...overrides,
  };
}

describe('createTourEngine', () => {
  it('runs prepare then shows a centered step immediately (null anchor)', async () => {
    const prepare = vi.fn();
    const deps = makeDeps([makeStep({ id: 'welcome', prepare })]);
    const engine = createTourEngine(deps);
    engine.start();
    await flush();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(engine.getState()).toMatchObject({ stepIndex: 0, phase: 'showing', anchorEl: null });
  });

  it('resolves the anchor token for the current viewport and stores the element', async () => {
    const el = document.createElement('button');
    const resolveAnchor = vi.fn(async () => el);
    const deps = makeDeps(
      [makeStep({ id: 'step', anchor: (v) => (v === 'desktop' ? 'desktop-token' : 'mobile-token') })],
      { resolveAnchor },
    );
    const engine = createTourEngine(deps);
    engine.start();
    await flush();
    expect(resolveAnchor).toHaveBeenCalledWith('desktop-token', expect.any(AbortSignal));
    expect(engine.getState()).toMatchObject({ phase: 'showing', anchorEl: el });
  });

  it('skips forward and reports the step when the anchor never resolves', async () => {
    const resolveAnchor = vi.fn(async (token: string) =>
      token === 'missing' ? null : document.createElement('div'),
    );
    const deps = makeDeps(
      [
        makeStep({ id: 'broken', anchor: () => 'missing' }),
        makeStep({ id: 'next-step', anchor: () => 'present' }),
      ],
      { resolveAnchor },
    );
    const engine = createTourEngine(deps);
    engine.start();
    await flush();
    expect(deps.onStepSkipped).toHaveBeenCalledWith('broken');
    expect(engine.getState()).toMatchObject({ stepIndex: 1, phase: 'showing' });
  });

  it('skips forward when prepare throws', async () => {
    const deps = makeDeps([
      makeStep({
        id: 'explodes',
        prepare: () => {
          throw new Error('nope');
        },
      }),
      makeStep({ id: 'after' }),
    ]);
    const engine = createTourEngine(deps);
    engine.start();
    await flush();
    expect(deps.onStepSkipped).toHaveBeenCalledWith('explodes');
    expect(engine.getState().stepIndex).toBe(1);
  });

  it('completes when skipping forward past the last step', async () => {
    const deps = makeDeps([makeStep({ id: 'only', anchor: () => 'missing' })], {
      resolveAnchor: vi.fn(async () => null),
    });
    const engine = createTourEngine(deps);
    engine.start();
    await flush();
    expect(deps.onComplete).toHaveBeenCalledTimes(1);
  });

  it('next() past the last step completes; back() below zero is a no-op', async () => {
    const deps = makeDeps([makeStep({ id: 'a' }), makeStep({ id: 'b' })]);
    const engine = createTourEngine(deps);
    engine.start();
    await flush();
    engine.back();
    await flush();
    expect(engine.getState().stepIndex).toBe(0);
    engine.next();
    await flush();
    expect(engine.getState().stepIndex).toBe(1);
    engine.next();
    await flush();
    expect(deps.onComplete).toHaveBeenCalledTimes(1);
  });

  it('skip() fires onSkip immediately, even mid-prepare', async () => {
    let release: () => void = () => {};
    const deps = makeDeps([
      makeStep({
        id: 'slow',
        prepare: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      }),
    ]);
    const engine = createTourEngine(deps);
    engine.start();
    engine.skip();
    expect(deps.onSkip).toHaveBeenCalledTimes(1);
    release();
    await flush();
    expect(deps.onComplete).not.toHaveBeenCalled();
  });

  it('caches the sample note id in ctx across steps within a run', async () => {
    const createSampleNote = vi.fn(async () => 'note-1');
    const seen: Array<string | null> = [];
    const steps = [
      makeStep({
        id: 'creates',
        prepare: async (controls, ctx) => {
          ctx.sampleNoteId = (await controls.createSampleNote?.()) ?? null;
        },
      }),
      makeStep({
        id: 'reads',
        prepare: (_controls, ctx) => {
          seen.push(ctx.sampleNoteId);
        },
      }),
    ];
    const engine = createTourEngine(makeDeps(steps, { getControls: () => ({ createSampleNote }) }));
    engine.start();
    await flush();
    engine.next();
    await flush();
    expect(seen).toEqual(['note-1']);
  });

  it('re-runs the current step prepare when the viewport changes', async () => {
    const viewports: string[] = [];
    const steps = [
      makeStep({
        id: 'step',
        prepare: (_controls, ctx) => {
          viewports.push(ctx.viewport);
        },
      }),
    ];
    const engine = createTourEngine(makeDeps(steps));
    engine.start();
    await flush();
    engine.setViewport('mobile');
    await flush();
    expect(viewports).toEqual(['desktop', 'mobile']);
    expect(engine.getState().viewport).toBe('mobile');
  });
});
