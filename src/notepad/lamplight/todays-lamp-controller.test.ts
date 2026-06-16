import { describe, it, expect } from 'vitest';
import { TodaysLampController } from './todays-lamp-controller';
import type { TodaysLampDeps } from './todays-lamp-controller';
import type { DailyDevotion } from '../storage/lamplight-artifacts';
import type { DailyDevotionGenerateResult } from '../storage/lamplight-adapter';

const devotion: DailyDevotion = {
  opening: 'op',
  scripture: { ref: 'Psalm 23:4', text: 't' },
  reflection: 'r',
  prompt: 'p',
  note_citations: [{ note_id: 'n1', reason: 'rest' }],
};

const devotionB: DailyDevotion = { ...devotion, opening: 'fresh' };

// A macrotask boundary; the chained-await microtask queue drains first.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * A hand-driven interval clock. The controller never sees real timers; we
 * advance the single loading-step interval ourselves with tick().
 */
function makeClock() {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  return {
    setInterval: (cb: () => void): number => {
      const id = nextId++;
      timers.set(id, cb);
      return id;
    },
    clearInterval: (handle: number): void => {
      timers.delete(handle);
    },
    /** Fire every active interval callback once (one tick). */
    tick: (): void => {
      for (const cb of timers.values()) cb();
    },
    activeCount: (): number => timers.size,
  };
}

const INPUTS = {
  userId: 'user-1',
  localDate: '2026-05-27',
  autoGenerate: true,
  loadingStepIntervalMs: 1000,
};

describe('TodaysLampController', () => {
  it('starts in loading{0} before any inputs are set', () => {
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => ({ ok: false, reason: 'network' }),
    });
    expect(c.getSnapshot()).toEqual({ phase: 'loading', loadingStep: 0 });
  });

  it('cache hit resolves to ready without calling generate', async () => {
    const clock = makeClock();
    let generateCalls = 0;
    const c = new TodaysLampController({
      getExisting: async () => devotion,
      generate: async () => {
        generateCalls += 1;
        return { ok: true, artifact: devotion, cached: false };
      },
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
    expect(generateCalls).toBe(0);
    expect(clock.activeCount()).toBe(0);
  });

  it('cache miss with autoGenerate generates and resolves to ready', async () => {
    const clock = makeClock();
    let generateCalls = 0;
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        generateCalls += 1;
        return { ok: true, artifact: devotion, cached: false };
      },
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
    expect(generateCalls).toBe(1);
    expect(clock.activeCount()).toBe(0);
  });

  it('cache miss with autoGenerate=false parks in idle without generating', async () => {
    const clock = makeClock();
    let generateCalls = 0;
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        generateCalls += 1;
        return { ok: true, artifact: devotion, cached: false };
      },
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });
    c.setInputs({ ...INPUTS, autoGenerate: false });
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'idle' });
    expect(generateCalls).toBe(0);
    expect(clock.activeCount()).toBe(0);
  });

  it('start() from idle generates exactly once and reaches ready', async () => {
    const clock = makeClock();
    let generateCalls = 0;
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        generateCalls += 1;
        return { ok: true, artifact: devotion, cached: false };
      },
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });
    c.setInputs({ ...INPUTS, autoGenerate: false });
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'idle' });
    c.start();
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
    expect(generateCalls).toBe(1);
  });

  it('advances loadingStep on each clock tick, capping at 2', async () => {
    const clock = makeClock();
    const c = new TodaysLampController({
      getExisting: async () => null,
      // Never resolves: the run stays in loading so ticks are observable.
      generate: () => new Promise<DailyDevotionGenerateResult>(() => {}),
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });
    c.setInputs(INPUTS);
    expect(c.getSnapshot()).toEqual({ phase: 'loading', loadingStep: 0 });
    await flush(); // getExisting → null → awaiting generate (pending)
    expect(c.getSnapshot()).toEqual({ phase: 'loading', loadingStep: 0 });
    clock.tick();
    expect(c.getSnapshot()).toEqual({ phase: 'loading', loadingStep: 1 });
    clock.tick();
    expect(c.getSnapshot()).toEqual({ phase: 'loading', loadingStep: 2 });
    clock.tick();
    expect(c.getSnapshot()).toEqual({ phase: 'loading', loadingStep: 2 });
  });

  it('drops a superseded run when a newer setInputs bumps the generation', async () => {
    const clock = makeClock();
    let releaseFirst!: (v: DailyDevotion | null) => void;
    const first = new Promise<DailyDevotion | null>((res) => {
      releaseFirst = res;
    });
    let call = 0;
    const c = new TodaysLampController({
      getExisting: () => {
        call += 1;
        return call === 1 ? first : Promise.resolve(devotionB);
      },
      generate: async () => ({ ok: false, reason: 'network' }),
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });
    c.setInputs(INPUTS); // run 1: blocks on `first`
    await flush();
    c.setInputs({ ...INPUTS, localDate: '2026-05-28' }); // run 2: bump gen, resolves devotionB
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotionB });
    releaseFirst(devotion); // late resolve from the superseded run 1
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotionB });
  });

  it('drops an in-flight run after dispose and clears the interval', async () => {
    const clock = makeClock();
    let release!: (v: DailyDevotion | null) => void;
    const c = new TodaysLampController({
      getExisting: () =>
        new Promise<DailyDevotion | null>((res) => {
          release = res;
        }),
      generate: async () => ({ ok: true, artifact: devotion, cached: false }),
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });
    c.setInputs(INPUTS);
    await flush();
    expect(clock.activeCount()).toBe(1);
    c.dispose();
    expect(clock.activeCount()).toBe(0);
    release(devotion); // late resolve, must be dropped
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'loading', loadingStep: 0 });
  });

  it('start() does not carry over into a later prop-driven run', async () => {
    const clock = makeClock();
    let generateCalls = 0;
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        generateCalls += 1;
        return { ok: true, artifact: devotion, cached: false };
      },
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });
    c.setInputs({ ...INPUTS, autoGenerate: false });
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'idle' });
    c.start();
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
    expect(generateCalls).toBe(1);
    // New day while still mounted: prop-driven run must NOT generate.
    c.setInputs({ ...INPUTS, localDate: '2026-05-28', autoGenerate: false });
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'idle' });
    expect(generateCalls).toBe(1);
  });

  it('propagates the generate failure reason to the error state', async () => {
    const clock = makeClock();
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => ({ ok: false, reason: 'validators_failed' }),
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'error', reason: 'validators_failed' });
  });

  it('maps a thrown generate to error/network', async () => {
    const clock = makeClock();
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        throw new Error('boom');
      },
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'error', reason: 'network' });
  });

  it('retry recovers from an error to ready', async () => {
    const clock = makeClock();
    const results: DailyDevotionGenerateResult[] = [
      { ok: false, reason: 'network' },
      { ok: true, artifact: devotion, cached: false },
    ];
    const deps: TodaysLampDeps = {
      getExisting: async () => null,
      generate: async () => results.shift() ?? { ok: false, reason: 'network' },
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    };
    const c = new TodaysLampController(deps);
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'error', reason: 'network' });
    c.retry();
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
  });
});
