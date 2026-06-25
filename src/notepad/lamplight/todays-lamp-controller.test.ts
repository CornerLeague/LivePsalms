import { describe, it, expect } from 'vitest';
import { TodaysLampController } from './todays-lamp-controller';
import type { TodaysLampDeps } from './todays-lamp-controller';
import type { DailyDevotion } from '../storage/lamplight-artifacts';
import type { DailyDevotionGenerateResult, DailyDevotionStreamEvent } from '../storage/lamplight-adapter';

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

const INPUTS = {
  userId: 'user-1',
  localDate: '2026-05-27',
  autoGenerate: true,
};

/**
 * Build a fake stream dep that replays the given events synchronously
 * (calls onEvent for each), then resolves. Records how many times it was called.
 */
function makeStream(events: DailyDevotionStreamEvent[]) {
  let callCount = 0;
  const stream: TodaysLampDeps['stream'] = async (
    _userId,
    _localDate,
    onEvent,
  ) => {
    callCount++;
    for (const ev of events) {
      onEvent(ev);
    }
  };
  return { stream, getCallCount: () => callCount };
}

describe('TodaysLampController', () => {
  // ── Assertion 1: initial state ────────────────────────────────────────────
  it('starts in retrieving{notes} before any inputs are set', () => {
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => ({ ok: false, reason: 'network' }),
    });
    expect(c.getSnapshot()).toEqual({ phase: 'retrieving', stage: 'notes' });
  });

  // ── Assertion 1 (cont): full streaming phase progression ─────────────────
  it('streams stage→piece×5→done and phases progress correctly (accumulating pieces)', async () => {
    const events: DailyDevotionStreamEvent[] = [
      { kind: 'stage', stage: 'notes' },
      { kind: 'stage', stage: 'scripture' },
      { kind: 'stage', stage: 'composing' },
      { kind: 'piece', field: 'opening', value: devotion.opening },
      { kind: 'piece', field: 'scripture', value: devotion.scripture },
      { kind: 'piece', field: 'reflection', value: devotion.reflection },
      { kind: 'piece', field: 'prompt', value: devotion.prompt },
      { kind: 'piece', field: 'note_citations', value: devotion.note_citations },
      { kind: 'done', artifact: devotion, cached: false },
    ];
    const phases: Array<import('./todays-lamp-controller').TodaysLampState> = [];
    const { stream } = makeStream(events);
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => ({ ok: false, reason: 'network' }),
      stream,
    });
    c.subscribe(() => phases.push(c.getSnapshot()));
    c.setInputs(INPUTS);
    await flush();

    // Find phase transitions (filter out consecutive duplicates for clarity)
    const unique = phases.filter((p, i) => i === 0 || JSON.stringify(p) !== JSON.stringify(phases[i - 1]));

    // Should pass through all the stage phases
    expect(unique.some((p) => p.phase === 'retrieving' && 'stage' in p && p.stage === 'notes')).toBe(true);
    expect(unique.some((p) => p.phase === 'retrieving' && 'stage' in p && p.stage === 'scripture')).toBe(true);
    expect(unique.some((p) => p.phase === 'retrieving' && 'stage' in p && p.stage === 'composing')).toBe(true);

    // Find the first generating state (after first piece)
    const firstGenerating = unique.find((p) => p.phase === 'generating');
    expect(firstGenerating).toBeDefined();
    // First piece emitted was 'opening' — early generating state has opening but NOT reflection
    expect(firstGenerating).toMatchObject({ phase: 'generating' });
    if (firstGenerating?.phase === 'generating') {
      expect('opening' in firstGenerating.pieces).toBe(true);
      expect('note_citations' in firstGenerating.pieces).toBe(false);
    }

    // Later generating state has more fields
    const allGenerating = unique.filter((p) => p.phase === 'generating');
    const lastGenerating = allGenerating[allGenerating.length - 1];
    if (lastGenerating?.phase === 'generating') {
      // By the last piece emit, all 5 fields should be accumulated
      expect(Object.keys(lastGenerating.pieces).length).toBe(5);
    }

    // Final state is ready
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
  });

  // ── Assertion 2: refining event ───────────────────────────────────────────
  it('refining event yields refining{pieces} phase, then done→ready', async () => {
    const events: DailyDevotionStreamEvent[] = [
      { kind: 'stage', stage: 'composing' },
      { kind: 'piece', field: 'opening', value: devotion.opening },
      { kind: 'piece', field: 'reflection', value: devotion.reflection },
      { kind: 'refining' },
      { kind: 'done', artifact: devotion, cached: false },
    ];
    const phases: Array<import('./todays-lamp-controller').TodaysLampState> = [];
    const { stream } = makeStream(events);
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => ({ ok: false, reason: 'network' }),
      stream,
    });
    c.subscribe(() => phases.push(c.getSnapshot()));
    c.setInputs(INPUTS);
    await flush();

    // Must have a refining phase with the accumulated pieces
    const refining = phases.find((p) => p.phase === 'refining');
    expect(refining).toBeDefined();
    if (refining?.phase === 'refining') {
      expect(refining.pieces.opening).toBe(devotion.opening);
      expect(refining.pieces.reflection).toBe(devotion.reflection);
    }

    // Final state is ready
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
  });

  // ── Assertion 3: cache hit ────────────────────────────────────────────────
  it('cache hit → ready with stream never called and generate never called', async () => {
    let generateCalls = 0;
    const { stream, getCallCount } = makeStream([{ kind: 'done', artifact: devotion, cached: false }]);
    const c = new TodaysLampController({
      getExisting: async () => devotion,
      generate: async () => {
        generateCalls++;
        return { ok: true, artifact: devotion, cached: false };
      },
      stream,
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
    expect(getCallCount()).toBe(0);
    expect(generateCalls).toBe(0);
  });

  // ── Assertion 4: stale fence / superseded run ─────────────────────────────
  it('superseding setInputs drops late events from the first run (stale fence)', async () => {
    // First run: getExisting blocks; we'll release it after the second run resolves
    let releaseFirst!: (v: DailyDevotion | null) => void;
    const first = new Promise<DailyDevotion | null>((res) => {
      releaseFirst = res;
    });
    let call = 0;
    const { stream } = makeStream([{ kind: 'done', artifact: devotionB, cached: false }]);
    const c = new TodaysLampController({
      getExisting: () => {
        call++;
        return call === 1 ? first : Promise.resolve(devotionB);
      },
      generate: async () => ({ ok: false, reason: 'network' }),
      stream,
    });
    c.setInputs(INPUTS); // run 1: blocks on `first`
    await flush();
    c.setInputs({ ...INPUTS, localDate: '2026-05-28' }); // run 2: bump gen, resolves devotionB
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotionB });
    releaseFirst(devotion); // late resolve from the superseded run 1
    await flush();
    // Must still show run 2's result — run 1 events dropped by stale fence
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotionB });
  });

  // ── Assertion 5: fallback ─────────────────────────────────────────────────
  it('stream emitting network error falls back to buffered generate → ready', async () => {
    let generateCalls = 0;
    const events: DailyDevotionStreamEvent[] = [
      { kind: 'error', reason: 'network' },
    ];
    const { stream } = makeStream(events);
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        generateCalls++;
        return { ok: true, artifact: devotion, cached: false };
      },
      stream,
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
    expect(generateCalls).toBe(1);
  });

  it('stream resolving with no terminal event falls back to buffered generate → ready', async () => {
    let generateCalls = 0;
    // No terminal event (done/error) — stream resolves silently
    const events: DailyDevotionStreamEvent[] = [
      { kind: 'stage', stage: 'notes' },
    ];
    const { stream } = makeStream(events);
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        generateCalls++;
        return { ok: true, artifact: devotion, cached: false };
      },
      stream,
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
    expect(generateCalls).toBe(1);
  });

  it('stream throwing falls back to buffered generate → ready', async () => {
    let generateCalls = 0;
    const throwingStream: TodaysLampDeps['stream'] = async () => {
      throw new Error('transport failure');
    };
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        generateCalls++;
        return { ok: true, artifact: devotion, cached: false };
      },
      stream: throwingStream,
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
    expect(generateCalls).toBe(1);
  });

  it('stream emitting validators_failed → error{validators_failed} with NO fallback', async () => {
    let generateCalls = 0;
    const events: DailyDevotionStreamEvent[] = [
      { kind: 'error', reason: 'validators_failed' },
    ];
    const { stream } = makeStream(events);
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        generateCalls++;
        return { ok: true, artifact: devotion, cached: false };
      },
      stream,
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'error', reason: 'validators_failed' });
    expect(generateCalls).toBe(0);
  });

  // ── Assertion 6: absent stream dep ───────────────────────────────────────
  it('absent stream dep → buffered generate used directly → ready', async () => {
    let generateCalls = 0;
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        generateCalls++;
        return { ok: true, artifact: devotion, cached: false };
      },
      // stream intentionally omitted
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
    expect(generateCalls).toBe(1);
  });

  it('absent stream dep with generate error → error{reason}', async () => {
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => ({ ok: false, reason: 'no_notes' }),
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'error', reason: 'no_notes' });
  });

  // ── Assertion 7: dispose() aborts signal + drops late events + retry ──────
  it('dispose() aborts the run signal and drops late events', async () => {
    let capturedSignal: AbortSignal | undefined;
    let releaseStream!: () => void;
    const blockingStream: TodaysLampDeps['stream'] = (_uid, _date, _onEvent, signal) => {
      capturedSignal = signal;
      return new Promise<void>((res) => {
        releaseStream = res;
      });
    };
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => ({ ok: true, artifact: devotion, cached: false }),
      stream: blockingStream,
    });
    c.setInputs(INPUTS);
    await flush(); // getExisting resolves null → now inside stream()
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    c.dispose();
    expect(capturedSignal!.aborted).toBe(true);

    // Even if stream resolves after dispose, state should not change
    const snapshotBeforeRelease = c.getSnapshot();
    releaseStream();
    await flush();
    expect(c.getSnapshot()).toEqual(snapshotBeforeRelease);
  });

  it('retry() after error recovers to ready', async () => {
    const results: DailyDevotionGenerateResult[] = [
      { ok: false, reason: 'network' },
      { ok: true, artifact: devotion, cached: false },
    ];
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => results.shift() ?? { ok: false, reason: 'network' },
      // No stream — uses buffered path so retry is straightforward
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'error', reason: 'network' });
    c.retry();
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
  });

  // ── Existing behavior preserved ───────────────────────────────────────────
  it('cache miss with autoGenerate=false parks in idle without generating', async () => {
    let generateCalls = 0;
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        generateCalls++;
        return { ok: true, artifact: devotion, cached: false };
      },
    });
    c.setInputs({ ...INPUTS, autoGenerate: false });
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'idle' });
    expect(generateCalls).toBe(0);
  });

  it('start() from idle generates exactly once and reaches ready', async () => {
    let generateCalls = 0;
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        generateCalls++;
        return { ok: true, artifact: devotion, cached: false };
      },
    });
    c.setInputs({ ...INPUTS, autoGenerate: false });
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'idle' });
    c.start();
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'ready', artifact: devotion });
    expect(generateCalls).toBe(1);
  });

  it('start() does not carry over into a later prop-driven run', async () => {
    let generateCalls = 0;
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        generateCalls++;
        return { ok: true, artifact: devotion, cached: false };
      },
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

  it('maps a thrown generate to error/network', async () => {
    const c = new TodaysLampController({
      getExisting: async () => null,
      generate: async () => {
        throw new Error('boom');
      },
    });
    c.setInputs(INPUTS);
    await flush();
    expect(c.getSnapshot()).toEqual({ phase: 'error', reason: 'network' });
  });
});
