import { describe, it, expect } from 'vitest';
import * as client from './reflection-constants';
// The Deno shared module (Task 2). It is a leaf constants file — no Deno globals — so it imports
// cleanly under vitest/node. This asserts the client mirror can never silently drift from the edge.
import * as deno from '../../../supabase/functions/_shared/reflection-constants';

describe('client reflection-constants (§17 mirror)', () => {
  it('carries the exact spec §17 values', () => {
    expect(client.ARRIVAL_HOUR_LOCAL).toBe(7);
    expect(client.BACKFILL_CAP).toBe(12);
    expect(client.MARKER_MIN).toBe(1);
    expect(client.MARKER_MAX).toBe(6);
    expect(client.LETTER_WORD_MIN).toBe(60);
    expect(client.LETTER_WORD_MAX).toBe(350);
    expect(client.VERBATIM_RUN_MAX_WORDS).toBe(8);
    expect(client.RETRY_ATTEMPT_CAP).toBe(3);
    expect(client.CANDIDATE_POOL_MIN).toBe(8);
    expect(client.CANDIDATE_POOL_MAX).toBe(12);
    expect(client.MONTHLY_PROMPT_VERSION).toBe('monthly-reflection-v1');
  });

  it('never drifts from the Deno _shared/reflection-constants.ts', () => {
    expect(client.ARRIVAL_HOUR_LOCAL).toBe(deno.ARRIVAL_HOUR_LOCAL);
    expect(client.BACKFILL_CAP).toBe(deno.BACKFILL_CAP);
    expect(client.MARKER_MIN).toBe(deno.MARKER_MIN);
    expect(client.MARKER_MAX).toBe(deno.MARKER_MAX);
    expect(client.LETTER_WORD_MIN).toBe(deno.LETTER_WORD_MIN);
    expect(client.LETTER_WORD_MAX).toBe(deno.LETTER_WORD_MAX);
    expect(client.VERBATIM_RUN_MAX_WORDS).toBe(deno.VERBATIM_RUN_MAX_WORDS);
    expect(client.RETRY_ATTEMPT_CAP).toBe(deno.RETRY_ATTEMPT_CAP);
    expect(client.CANDIDATE_POOL_MIN).toBe(deno.CANDIDATE_POOL_MIN);
    expect(client.CANDIDATE_POOL_MAX).toBe(deno.CANDIDATE_POOL_MAX);
    expect(client.MONTHLY_PROMPT_VERSION).toBe(deno.MONTHLY_PROMPT_VERSION);
  });
});
