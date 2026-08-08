import { describe, it, expect, vi } from 'vitest';
import { processSafetyJob, type SafetyJobOps } from './process-safety-job.ts';
import type { Job } from './process-job.ts';
import type { CrisisVerdict } from './crisis-classifier.ts';

const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1', user_id: 'u1', kind: 'note_safety', payload: { note_id: 'n1' }, attempts: 0, ...over,
});

function verdict(over: Partial<CrisisVerdict> = {}): CrisisVerdict {
  return { safety_class: 'ok', reason: 'r', classifier_version: 'crisis-test-v1', failedClosed: false, ...over };
}

function ops(over: Partial<SafetyJobOps> = {}): SafetyJobOps {
  return {
    loadNote: vi.fn(async () => ({ id: 'n1', user_id: 'u1', content: 'a real entry with words in it' })),
    upsertSafety: vi.fn(async () => {}),
    markDone: vi.fn(async () => {}),
    markFailedOrRetry: vi.fn(async () => {}),
    ...over,
  };
}

describe('processSafetyJob', () => {
  it('classifies the note and records the verdict', async () => {
    const o = ops();
    await processSafetyJob(job(), o, async () => verdict({ safety_class: 'lament', reason: 'grief' }));

    expect(o.upsertSafety).toHaveBeenCalledWith(expect.objectContaining({
      noteId: 'n1', userId: 'u1', safetyClass: 'lament', classifierVersion: 'crisis-test-v1',
    }));
    expect(o.markDone).toHaveBeenCalledWith('j1');
  });

  it('records prefilter_hit alongside the verdict, for measurement', async () => {
    const o = ops({
      loadNote: vi.fn(async () => ({ id: 'n1', user_id: 'u1', content: 'I have decided to end my life' })),
    });
    await processSafetyJob(job(), o, async () => verdict({ safety_class: 'risk' }));
    expect(o.upsertSafety).toHaveBeenCalledWith(expect.objectContaining({ prefilterHit: true }));
  });

  it('⚠️ writes a row even for an ordinary note — absence of a row means WITHHELD', async () => {
    // The gate reads a missing row as "withhold". A job that only wrote rows
    // for concerning notes would leave every ordinary note permanently
    // invisible to generation, which is the whole product.
    const o = ops();
    await processSafetyJob(job(), o, async () => verdict({ safety_class: 'ok' }));
    expect(o.upsertSafety).toHaveBeenCalledWith(expect.objectContaining({ safetyClass: 'ok' }));
  });

  it('⚠️ RETRIES when the classifier fell closed, rather than persisting a false risk', async () => {
    // failedClosed means the model could not answer, not that the entry is
    // risky. Persisting it would permanently withhold an ordinary note AND
    // inflate the risk rate — the one number this slice exists to watch.
    const o = ops();
    await processSafetyJob(job(), o, async () => verdict({ safety_class: 'risk', failedClosed: true }));

    expect(o.upsertSafety).not.toHaveBeenCalled();
    expect(o.markDone).not.toHaveBeenCalled();
    expect(o.markFailedOrRetry).toHaveBeenCalled();
  });

  it('persists a GENUINE risk verdict', async () => {
    const o = ops();
    await processSafetyJob(job(), o, async () => verdict({ safety_class: 'risk', failedClosed: false }));
    expect(o.upsertSafety).toHaveBeenCalledWith(expect.objectContaining({ safetyClass: 'risk' }));
    expect(o.markDone).toHaveBeenCalled();
  });

  it('is idempotent — a second run upserts the same row rather than duplicating', async () => {
    const o = ops();
    const classify = async () => verdict({ safety_class: 'ok' });
    await processSafetyJob(job(), o, classify);
    await processSafetyJob(job(), o, classify);
    expect(o.upsertSafety).toHaveBeenCalledTimes(2);
    const [a, b] = (o.upsertSafety as ReturnType<typeof vi.fn>).mock.calls;
    expect(a[0].noteId).toBe(b[0].noteId);
  });

  it('marks a deleted note done rather than retrying forever', async () => {
    const o = ops({ loadNote: vi.fn(async () => null) });
    await processSafetyJob(job(), o, async () => verdict());
    expect(o.markDone).toHaveBeenCalledWith('j1');
    expect(o.upsertSafety).not.toHaveBeenCalled();
  });

  it('records an empty note as ok without calling the classifier', async () => {
    const classify = vi.fn(async () => verdict());
    const o = ops({ loadNote: vi.fn(async () => ({ id: 'n1', user_id: 'u1', content: '' })) });
    await processSafetyJob(job(), o, classify);

    expect(classify).not.toHaveBeenCalled();
    expect(o.upsertSafety).toHaveBeenCalledWith(expect.objectContaining({ safetyClass: 'ok' }));
  });

  it('rejects a payload with no note id', async () => {
    const o = ops();
    await processSafetyJob(job({ payload: {} }), o, async () => verdict());
    expect(o.markFailedOrRetry).toHaveBeenCalled();
    expect(o.upsertSafety).not.toHaveBeenCalled();
  });

  it('retries when the write itself fails', async () => {
    const o = ops({ upsertSafety: vi.fn(async () => { throw new Error('db down'); }) });
    await processSafetyJob(job(), o, async () => verdict());
    expect(o.markFailedOrRetry).toHaveBeenCalled();
    expect(o.markDone).not.toHaveBeenCalled();
  });
});
