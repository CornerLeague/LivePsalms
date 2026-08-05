import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseLamplightAdapter } from './supabase-lamplight-adapter';

interface SettingsRow {
  user_id: string;
  enabled: boolean;
  quiet_mode: boolean;
  inline_suggestions: boolean;
  weekly_email: boolean;
  consent_decided_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EntitlementRow {
  user_id: string;
  tier: string;
  source: string | null;
  granted_at: string | null;
  expires_at: string | null;
}

interface ConfigRow {
  key: string;
  value: unknown;
}

interface Backend {
  settings: SettingsRow[];
  entitlements: EntitlementRow[];
  config: ConfigRow[];
  deletes: { table: string; userId: string }[];
}

function makeClient(backend: Backend): SupabaseClient {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq(_col: string, val: string) {
              return {
                async maybeSingle() {
                  if (table === 'lamplight_settings') {
                    return { data: backend.settings.find((r) => r.user_id === val) ?? null, error: null };
                  }
                  if (table === 'lamplight_entitlements') {
                    return { data: backend.entitlements.find((r) => r.user_id === val) ?? null, error: null };
                  }
                  if (table === 'app_config') {
                    return { data: backend.config.find((r) => r.key === val) ?? null, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
            in(_col: string, vals: string[]) {
              return {
                async then(resolve: (v: { data: unknown[]; error: null }) => void) {
                  if (table === 'app_config') {
                    resolve({ data: backend.config.filter((r) => vals.includes(r.key)), error: null });
                  }
                },
              };
            },
          };
        },
        upsert(payload: Record<string, unknown>) {
          return {
            select() {
              return {
                async single() {
                  if (table === 'lamplight_settings') {
                    const userId = payload.user_id as string;
                    const idx = backend.settings.findIndex((r) => r.user_id === userId);
                    const now = new Date().toISOString();
                    const existing = idx >= 0 ? backend.settings[idx] : null;
                    const row: SettingsRow = {
                      user_id: userId,
                      enabled: false,
                      quiet_mode: false,
                      inline_suggestions: true,
                      weekly_email: false,
                      consent_decided_at: null,
                      created_at: existing?.created_at ?? now,
                      updated_at: now,
                      ...(existing ?? {}),
                      ...payload,
                    } as SettingsRow;
                    if (idx >= 0) backend.settings[idx] = row;
                    else backend.settings.push(row);
                    return { data: row, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
        delete() {
          return {
            async eq(_col: string, val: string) {
              backend.deletes.push({ table, userId: val });
              if (table === 'lamplight_settings') backend.settings = backend.settings.filter((r) => r.user_id !== val);
              if (table === 'lamplight_entitlements') backend.entitlements = backend.entitlements.filter((r) => r.user_id !== val);
              return { error: null };
            },
            // lamplight_connections has no user_id; delete via tautology predicate.
            async not(_col: string, _op: string, _val: unknown) {
              backend.deletes.push({ table, userId: '<rls-scoped>' });
              return { error: null };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe('SupabaseLamplightAdapter — settings', () => {
  let backend: Backend;
  let adapter: SupabaseLamplightAdapter;

  beforeEach(() => {
    backend = { settings: [], entitlements: [], config: [], deletes: [] };
    adapter = new SupabaseLamplightAdapter(makeClient(backend));
  });

  it('returns null when no settings row exists for the user', async () => {
    expect(await adapter.getSettings('user-1')).toBeNull();
  });

  it('returns mapped settings when a row exists', async () => {
    backend.settings.push({
      user_id: 'user-1',
      enabled: true,
      quiet_mode: false,
      inline_suggestions: true,
      weekly_email: false,
      consent_decided_at: '2026-05-25T00:00:00Z',
      created_at: '2026-05-25T00:00:00Z',
      updated_at: '2026-05-25T00:00:00Z',
    });
    const s = await adapter.getSettings('user-1');
    expect(s).toEqual({
      userId: 'user-1',
      enabled: true,
      quietMode: false,
      inlineSuggestions: true,
      weeklyEmail: false,
      consentDecidedAt: '2026-05-25T00:00:00Z',
      createdAt: '2026-05-25T00:00:00Z',
      updatedAt: '2026-05-25T00:00:00Z',
    });
  });

  it('upserts settings with defaults on first write', async () => {
    const s = await adapter.upsertSettings('user-1', {
      enabled: true,
      consentDecidedAt: '2026-05-25T00:00:00Z',
    });
    expect(s.userId).toBe('user-1');
    expect(s.enabled).toBe(true);
    expect(s.consentDecidedAt).toBe('2026-05-25T00:00:00Z');
    expect(backend.settings).toHaveLength(1);
  });

  it('deletes settings + entitlements rows for the user via deleteAllUserData', async () => {
    backend.settings.push({
      user_id: 'user-1', enabled: true, quiet_mode: false,
      inline_suggestions: true, weekly_email: false,
      consent_decided_at: null,
      created_at: '2026-05-25T00:00:00Z', updated_at: '2026-05-25T00:00:00Z',
    });
    backend.entitlements.push({
      user_id: 'user-1', tier: 'plus', source: 'grant',
      granted_at: '2026-05-25T00:00:00Z', expires_at: null,
    });
    await adapter.deleteAllUserData('user-1');
    expect(backend.settings).toHaveLength(0);
    expect(backend.entitlements).toHaveLength(0);
    const deletedTables = backend.deletes.map((d) => d.table).sort();
    expect(deletedTables).toEqual([
      'lamplight_artifacts',
      'lamplight_connections',
      'lamplight_embeddings',
      'lamplight_entitlements',
      'lamplight_jobs',
      'lamplight_settings',
      'lamplight_suggestions_log',
    ]);
  });
});

describe('SupabaseLamplightAdapter — entitlement + promo', () => {
  let backend: Backend;
  let adapter: SupabaseLamplightAdapter;

  beforeEach(() => {
    backend = { settings: [], entitlements: [], config: [], deletes: [] };
    adapter = new SupabaseLamplightAdapter(makeClient(backend));
  });

  it('returns null when no entitlement row exists', async () => {
    expect(await adapter.getEntitlement('user-1')).toBeNull();
  });

  it('returns mapped entitlement when a row exists', async () => {
    backend.entitlements.push({
      user_id: 'user-1', tier: 'plus', source: 'grant',
      granted_at: '2026-05-25T00:00:00Z', expires_at: null,
    });
    const e = await adapter.getEntitlement('user-1');
    expect(e).toEqual({
      userId: 'user-1',
      tier: 'plus',
      source: 'grant',
      grantedAt: '2026-05-25T00:00:00Z',
      expiresAt: null,
    });
  });

  it('returns { promoActive: false, promoEndsAt: null } when config rows are absent', async () => {
    expect(await adapter.getPromoConfig()).toEqual({ promoActive: false, promoEndsAt: null });
  });

  it('returns promo config values from app_config', async () => {
    backend.config.push({ key: 'lamplight_promo_active', value: true });
    backend.config.push({ key: 'lamplight_promo_ends_at', value: null });
    expect(await adapter.getPromoConfig()).toEqual({ promoActive: true, promoEndsAt: null });
  });

  it('does NOT treat JSON string "false" as promoActive=true', async () => {
    backend.config.push({ key: 'lamplight_promo_active', value: 'false' });
    expect(await adapter.getPromoConfig()).toEqual({ promoActive: false, promoEndsAt: null });
  });
});

describe('SupabaseLamplightAdapter.getConnectionCardThresholds', () => {
  let backend: Backend;
  let adapter: SupabaseLamplightAdapter;

  beforeEach(() => {
    backend = { settings: [], entitlements: [], config: [], deletes: [] };
    adapter = new SupabaseLamplightAdapter(makeClient(backend));
  });

  it('falls back to spec value (0.78) when row is absent', async () => {
    expect(await adapter.getConnectionCardThresholds()).toEqual({ minSimilarity: 0.78 });
  });

  it('returns the configured similarity when row is present', async () => {
    backend.config.push({ key: 'lamplight_min_similarity', value: 0.3 });
    expect(await adapter.getConnectionCardThresholds()).toEqual({ minSimilarity: 0.3 });
  });

  it('falls back to 0.78 when value is non-numeric', async () => {
    backend.config.push({ key: 'lamplight_min_similarity', value: 'oops' });
    expect(await adapter.getConnectionCardThresholds()).toEqual({ minSimilarity: 0.78 });
  });

  it('falls back to 0.78 when value is out of [0, 1]', async () => {
    backend.config.push({ key: 'lamplight_min_similarity', value: 1.5 });
    expect(await adapter.getConnectionCardThresholds()).toEqual({ minSimilarity: 0.78 });
  });
});

import type { DailyDevotion } from './lamplight-artifacts';
import type { SseEvent, StreamInvoke } from '../bible/lamplight-stream-client';
import type { DailyDevotionStreamEvent } from './lamplight-adapter';

describe('SupabaseLamplightAdapter.getDailyDevotion', () => {
  it('returns the body field from the matching row', async () => {
    const devotion: DailyDevotion = {
      opening: 'opening', scripture: { ref: 'Psalm 23:4', text: 't' },
      reflection: 'r', prompt: 'p',
      note_citations: [{ note_id: 'n1', reason: 'rest' }],
    };
    const client = {
      from(table: string) {
        expect(table).toBe('lamplight_artifacts');
        return {
          select: (cols: string) => {
            expect(cols).toBe('body');
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    async maybeSingle() {
                      return { data: { body: devotion }, error: null };
                    },
                  }),
                }),
              }),
            };
          },
        };
      },
    };
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.getDailyDevotion('user-1', '2026-05-27')).toEqual(devotion);
  });

  it('returns null when no row exists', async () => {
    const client = {
      from() {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ async maybeSingle() { return { data: null, error: null }; } }) }) }),
          }),
        };
      },
    };
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.getDailyDevotion('user-1', '2026-05-27')).toBeNull();
  });
});

describe('SupabaseLamplightAdapter.generateDailyDevotion', () => {
  const devotion: DailyDevotion = {
    opening: 'op', scripture: { ref: 'Psalm 23:4', text: 't' },
    reflection: 'r', prompt: 'p',
    note_citations: [{ note_id: 'n1', reason: 'rest' }],
  };

  it('returns ok:true with artifact and cached flag from the function response', async () => {
    const client = {
      functions: {
        async invoke(name: string, opts: { body: unknown }) {
          expect(name).toBe('lamplight-generate');
          expect(opts.body).toEqual({ kind: 'daily_devotion', user_id: 'user-1', local_date: '2026-05-27' });
          return { data: { ok: true, artifact: devotion, cached: false }, error: null };
        },
      },
    };
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    const result = await adapter.generateDailyDevotion('user-1', '2026-05-27');
    expect(result).toEqual({ ok: true, artifact: devotion, cached: false });
  });

  it('maps ok:false reasons through unchanged', async () => {
    for (const reason of ['no_notes', 'validators_failed'] as const) {
      const client = {
        functions: {
          async invoke() { return { data: { ok: false, reason }, error: null }; },
        },
      };
      const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
      expect(await adapter.generateDailyDevotion('user-1', '2026-05-27')).toEqual({ ok: false, reason });
    }
  });

  it('returns network reason on functions.invoke error', async () => {
    const client = {
      functions: {
        async invoke() { return { data: null, error: { message: 'transport' } }; },
      },
    };
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.generateDailyDevotion('user-1', '2026-05-27')).toEqual({ ok: false, reason: 'network' });
  });

  it('returns network reason on thrown error', async () => {
    const client = {
      functions: {
        async invoke() { throw new Error('boom'); },
      },
    };
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.generateDailyDevotion('user-1', '2026-05-27')).toEqual({ ok: false, reason: 'network' });
  });
});

describe('SupabaseLamplightAdapter.getConnectionNeighbors', () => {
  it('calls match_my_note_neighbors with k and maps rows', async () => {
    const rpcCalls: Array<{ name: string; args: unknown }> = [];
    const client = {
      async rpc(name: string, args: unknown) {
        rpcCalls.push({ name, args });
        return {
          data: [
            { related_note_id: 'note-2', similarity: 0.91 },
            { related_note_id: 'note-3', similarity: 0.83 },
          ],
          error: null,
        };
      },
    };
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    const result = await adapter.getConnectionNeighbors('note-1', 5);
    expect(result).toEqual([
      { relatedNoteId: 'note-2', similarity: 0.91 },
      { relatedNoteId: 'note-3', similarity: 0.83 },
    ]);
    expect(rpcCalls[0]).toEqual({
      name: 'match_my_note_neighbors',
      args: { p_source_note_id: 'note-1', p_k: 5 },
    });
  });

  it('defaults k=5 when omitted', async () => {
    const rpcCalls: Array<{ name: string; args: unknown }> = [];
    const client = {
      async rpc(name: string, args: unknown) {
        rpcCalls.push({ name, args });
        return { data: [], error: null };
      },
    };
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    await adapter.getConnectionNeighbors('note-1');
    expect(rpcCalls[0].args).toEqual({ p_source_note_id: 'note-1', p_k: 5 });
  });

  it('throws on RPC error', async () => {
    const client = {
      async rpc() {
        return { data: null, error: { message: 'not authorized' } };
      },
    };
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    await expect(adapter.getConnectionNeighbors('note-1')).rejects.toBeTruthy();
  });
});

describe('SupabaseLamplightAdapter.hasNoteEmbedding', () => {
  it('returns true when count > 0', async () => {
    const client = {
      from(_table: string) {
        return {
          select(_col: string, _opts: unknown) {
            return {
              eq(_col2: string, _val: string) {
                return {
                  async eq(_col3: string, _val3: string) {
                    return { count: 1, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.hasNoteEmbedding('note-1')).toBe(true);
  });

  it('returns false when count = 0', async () => {
    const client = {
      from(_table: string) {
        return {
          select(_col: string, _opts: unknown) {
            return {
              eq(_col2: string, _val: string) {
                return {
                  async eq(_col3: string, _val3: string) {
                    return { count: 0, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.hasNoteEmbedding('note-1')).toBe(false);
  });
});

describe('SupabaseLamplightAdapter.generateConnectionWhy', () => {
  function makeClient(invokeResult: { data: unknown; error: unknown }) {
    return {
      auth: {
        async getUser() {
          return { data: { user: { id: 'user-1' } } };
        },
      },
      functions: {
        async invoke(_name: string, _opts: { body: unknown }) {
          return invokeResult;
        },
      },
    };
  }

  it('returns ok with cached=false on success', async () => {
    const client = makeClient({
      data: { ok: true, why: 'They share a shepherd image.', cached: false },
      error: null,
    });
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    const result = await adapter.generateConnectionWhy('note-1', 'note-2');
    expect(result).toEqual({ ok: true, why: 'They share a shepherd image.', cached: false });
  });

  it('returns cached=true when function says so', async () => {
    const client = makeClient({
      data: { ok: true, why: 'cached why', cached: true },
      error: null,
    });
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    const result = await adapter.generateConnectionWhy('note-1', 'note-2');
    expect(result).toEqual({ ok: true, why: 'cached why', cached: true });
  });

  it('maps no_embedding reason', async () => {
    const client = makeClient({
      data: { ok: false, reason: 'no_embedding' },
      error: null,
    });
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.generateConnectionWhy('note-1', 'note-2')).toEqual({
      ok: false,
      reason: 'no_embedding',
    });
  });

  it('maps not_neighbor reason', async () => {
    const client = makeClient({
      data: { ok: false, reason: 'not_neighbor' },
      error: null,
    });
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.generateConnectionWhy('note-1', 'note-2')).toEqual({
      ok: false,
      reason: 'not_neighbor',
    });
  });

  it('maps validators_failed reason', async () => {
    const client = makeClient({
      data: { ok: false, reason: 'validators_failed' },
      error: null,
    });
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.generateConnectionWhy('note-1', 'note-2')).toEqual({
      ok: false,
      reason: 'validators_failed',
    });
  });

  it('returns network on transport error', async () => {
    const client = makeClient({ data: null, error: { message: 'boom' } });
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.generateConnectionWhy('note-1', 'note-2')).toEqual({
      ok: false,
      reason: 'network',
    });
  });

  it('returns network when auth.getUser returns null', async () => {
    const client = {
      auth: {
        async getUser() {
          return { data: { user: null } };
        },
      },
      functions: {
        async invoke() {
          return { data: { ok: true, why: 'x' }, error: null };
        },
      },
    };
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.generateConnectionWhy('note-1', 'note-2')).toEqual({
      ok: false,
      reason: 'network',
    });
  });
});

// ── streamDailyDevotion ─────────────────────────────────────────────────────

/**
 * Build a fake StreamInvoke that replays a scripted list of SseEvents, then
 * resolves. The test injects this via the optional 2nd constructor arg so
 * makeStreamInvoke (and thus import.meta.env / fetch) is never called.
 */
function makeFakeStreamInvoke(events: SseEvent[], throwErr?: Error): StreamInvoke {
  return async (_name, _body, handlers) => {
    if (throwErr) throw throwErr;
    for (const ev of events) {
      handlers.onEvent(ev);
    }
  };
}

describe('SupabaseLamplightAdapter.streamDailyDevotion', () => {
  const baseClient = {} as unknown as SupabaseClient;

  const devotion: DailyDevotion = {
    opening: 'The Lord is my shepherd',
    scripture: { ref: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not want.' },
    reflection: 'Rest in His provision.',
    prompt: 'Where do you need rest today?',
    note_citations: [{ note_id: 'note-42', reason: 'rest imagery' }],
  };

  it('happy path: maps all SSE events in order, ending with done', async () => {
    const events: SseEvent[] = [
      { t: 'stage', stage: 'notes' },
      { t: 'stage', stage: 'scripture' },
      { t: 'stage', stage: 'composing' },
      { t: 'piece', field: 'opening', value: devotion.opening },
      { t: 'piece', field: 'scripture', value: devotion.scripture },
      { t: 'piece', field: 'reflection', value: devotion.reflection },
      { t: 'piece', field: 'prompt', value: devotion.prompt },
      { t: 'piece', field: 'note_citations', value: devotion.note_citations },
      { t: 'done', payload: { ok: true, artifact: devotion, cached: false, model_used: 'x' } },
    ];

    const received: DailyDevotionStreamEvent[] = [];
    const adapter = new SupabaseLamplightAdapter(baseClient, makeFakeStreamInvoke(events));
    await adapter.streamDailyDevotion!('user-1', '2026-06-24', (ev) => received.push(ev));

    expect(received).toEqual([
      { kind: 'stage', stage: 'notes' },
      { kind: 'stage', stage: 'scripture' },
      { kind: 'stage', stage: 'composing' },
      { kind: 'piece', field: 'opening', value: devotion.opening },
      { kind: 'piece', field: 'scripture', value: devotion.scripture },
      { kind: 'piece', field: 'reflection', value: devotion.reflection },
      { kind: 'piece', field: 'prompt', value: devotion.prompt },
      { kind: 'piece', field: 'note_citations', value: devotion.note_citations },
      { kind: 'done', artifact: devotion, cached: false },
    ]);
  });

  it('transport throw: emits exactly one {kind:error,reason:network}', async () => {
    const received: DailyDevotionStreamEvent[] = [];
    const adapter = new SupabaseLamplightAdapter(
      baseClient,
      makeFakeStreamInvoke([], new Error('connection refused')),
    );
    await adapter.streamDailyDevotion!('user-1', '2026-06-24', (ev) => received.push(ev));

    expect(received).toEqual([{ kind: 'error', reason: 'network' }]);
  });

  it('SSE error with reason no_notes maps to {kind:error,reason:no_notes}', async () => {
    const events: SseEvent[] = [{ t: 'error', reason: 'no_notes' }];
    const received: DailyDevotionStreamEvent[] = [];
    const adapter = new SupabaseLamplightAdapter(baseClient, makeFakeStreamInvoke(events));
    await adapter.streamDailyDevotion!('user-1', '2026-06-24', (ev) => received.push(ev));

    expect(received).toEqual([{ kind: 'error', reason: 'no_notes' }]);
  });

  it('SSE error with reason validators_failed maps to {kind:error,reason:validators_failed}', async () => {
    const events: SseEvent[] = [{ t: 'error', reason: 'validators_failed' }];
    const received: DailyDevotionStreamEvent[] = [];
    const adapter = new SupabaseLamplightAdapter(baseClient, makeFakeStreamInvoke(events));
    await adapter.streamDailyDevotion!('user-1', '2026-06-24', (ev) => received.push(ev));

    expect(received).toEqual([{ kind: 'error', reason: 'validators_failed' }]);
  });

  it('SSE error with unknown reason maps to {kind:error,reason:network}', async () => {
    const events: SseEvent[] = [{ t: 'error', reason: 'unexpected_server_blowup' }];
    const received: DailyDevotionStreamEvent[] = [];
    const adapter = new SupabaseLamplightAdapter(baseClient, makeFakeStreamInvoke(events));
    await adapter.streamDailyDevotion!('user-1', '2026-06-24', (ev) => received.push(ev));

    expect(received).toEqual([{ kind: 'error', reason: 'network' }]);
  });

  it('ignores text and replace SSE events (no output events for them)', async () => {
    const events: SseEvent[] = [
      { t: 'stage', stage: 'composing' },
      { t: 'text', field: 'opening', delta: 'ignored delta' },
      { t: 'replace', payload: { some: 'data' } },
      { t: 'piece', field: 'opening', value: 'Hello' },
      { t: 'refining' },
      { t: 'done', payload: { ok: true, artifact: devotion, cached: true } },
    ];
    const received: DailyDevotionStreamEvent[] = [];
    const adapter = new SupabaseLamplightAdapter(baseClient, makeFakeStreamInvoke(events));
    await adapter.streamDailyDevotion!('user-1', '2026-06-24', (ev) => received.push(ev));

    expect(received).toEqual([
      { kind: 'stage', stage: 'composing' },
      { kind: 'piece', field: 'opening', value: 'Hello' },
      { kind: 'refining' },
      { kind: 'done', artifact: devotion, cached: true },
    ]);
  });

  it('done payload missing artifact maps to {kind:error,reason:network}', async () => {
    const events: SseEvent[] = [
      { t: 'done', payload: { ok: false, reason: 'something_weird' } },
    ];
    const received: DailyDevotionStreamEvent[] = [];
    const adapter = new SupabaseLamplightAdapter(baseClient, makeFakeStreamInvoke(events));
    await adapter.streamDailyDevotion!('user-1', '2026-06-24', (ev) => received.push(ev));

    expect(received).toEqual([{ kind: 'error', reason: 'network' }]);
  });
});

describe('SupabaseLamplightAdapter — admin jobs', () => {
  function makeRpcClient(data: unknown) {
    return {
      async rpc() {
        return { data, error: null };
      },
    };
  }

  it('adminListJobs maps a snake_case row → camelCase AdminJobRow (email survives, null fields coalesce)', async () => {
    const client = makeRpcClient([
      {
        id: 'job-1',
        user_id: 'user-1',
        email: 'person@example.com',
        kind: 'daily_devotion',
        status: 'failed',
        attempts: 2,
        payload: { foo: 'bar' },
        scheduled_at: '2026-06-14T00:00:00Z',
        started_at: null,
        finished_at: null,
        error: null,
      },
    ]);
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.adminListJobs({ status: ['failed'] })).toEqual([
      {
        id: 'job-1',
        userId: 'user-1',
        email: 'person@example.com',
        kind: 'daily_devotion',
        status: 'failed',
        attempts: 2,
        payload: { foo: 'bar' },
        scheduledAt: '2026-06-14T00:00:00Z',
        startedAt: null,
        finishedAt: null,
        error: null,
      },
    ]);
  });

  it('adminRequeueJob maps its row AND forces email:null even when the row carries an email', async () => {
    // The admin_requeue_lamplight_job RPC does NOT join email — the requeue
    // path hardcodes null regardless of what the row happens to contain.
    const client = makeRpcClient({
      id: 'job-9',
      user_id: 'user-2',
      email: 'should-be-ignored@example.com',
      kind: 'connection_card_why',
      status: 'queued',
      attempts: 0,
      payload: null,
      scheduled_at: '2026-06-14T12:00:00Z',
      started_at: '2026-06-14T12:01:00Z',
      finished_at: null,
      error: null,
    });
    const adapter = new SupabaseLamplightAdapter(client as unknown as SupabaseClient);
    expect(await adapter.adminRequeueJob('job-9')).toEqual({
      id: 'job-9',
      userId: 'user-2',
      email: null,
      kind: 'connection_card_why',
      status: 'queued',
      attempts: 0,
      payload: null,
      scheduledAt: '2026-06-14T12:00:00Z',
      startedAt: '2026-06-14T12:01:00Z',
      finishedAt: null,
      error: null,
    });
  });
});

describe('SupabaseLamplightAdapter.generateEtymologyInsight', () => {
  function clientWith(invokeResult: { data: unknown; error: unknown }) {
    const invoke = vi.fn().mockResolvedValue(invokeResult);
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      functions: { invoke },
    };
    return { client, invoke };
  }

  it('maps a successful edge-fn response to { ok:true, body, cached }', async () => {
    const { client, invoke } = clientWith({ data: { ok: true, body: 'Insight.', cached: false }, error: null });
    const adapter = new SupabaseLamplightAdapter(client as never);
    const res = await adapter.generateEtymologyInsight('H7462', 'psa.23.1');
    expect(invoke).toHaveBeenCalledWith('etymology-insight', { body: { strongs: 'H7462', verse_id: 'psa.23.1' } });
    expect(res).toEqual({ ok: true, body: 'Insight.', cached: false });
  });

  it('maps a no_entry failure through, and a transport error to network', async () => {
    const noEntry = new SupabaseLamplightAdapter(clientWith({ data: { ok: false, reason: 'no_entry' }, error: null }).client as never);
    expect(await noEntry.generateEtymologyInsight('H1', 'psa.23.1')).toEqual({ ok: false, reason: 'no_entry' });

    const boom = new SupabaseLamplightAdapter(clientWith({ data: null, error: { message: 'boom' } }).client as never);
    expect(await boom.generateEtymologyInsight('H1', 'psa.23.1')).toEqual({ ok: false, reason: 'network' });
  });
});

// ── Slice 1d: artifact provenance ────────────────────────────────────────────
// Fetched on demand rather than widened into getDailyDevotion/getReflection:
// the panel is a disclosure that is closed by default, so eagerly loading its
// data on every Today's Lamp render would be work almost nobody looks at — and
// it keeps the devotion controller's state shape untouched.

interface ProvBackend {
  artifacts: Array<Record<string, unknown>>;
  notes: Array<{ id: string; title: string | null }>;
  lastSelect?: string;
  lastFilters?: Array<[string, unknown]>;
  lastIn?: string[];
}

function makeProvClient(backend: ProvBackend): SupabaseClient {
  backend.lastFilters = [];
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const chain = {
        select(cols: string) {
          backend.lastSelect = cols;
          return chain;
        },
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          backend.lastFilters = filters;
          return chain;
        },
        in(_col: string, ids: string[]) {
          backend.lastIn = ids;
          return Promise.resolve({
            data: backend.notes.filter((n) => ids.includes(n.id)),
            error: null,
          });
        },
        async maybeSingle() {
          if (table !== 'lamplight_artifacts') return { data: null, error: null };
          const row = backend.artifacts.find((a) =>
            filters.every(([col, val]) => a[col] === val));
          return { data: row ?? null, error: null };
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

const ARTIFACT_ROW = {
  user_id: 'u1',
  type: 'daily_devotion',
  period_key: '2026-08-07',
  source_note_ids: ['n1', 'n2'],
  source_verses: ['Psalm 23:4'],
  source_library_chunks: [{ chunk_id: 'lc1', source_id: 'treasury-of-david', heading: 'Psalm 23:4' }],
  model_used: 'gpt-5.6-terra',
  prompt_version: 'daily-devotion-2026-08-06-v4',
};

describe('SupabaseLamplightAdapter.getArtifactProvenance', () => {
  it('maps snake_case to camelCase inside the adapter (house rule)', async () => {
    const backend: ProvBackend = { artifacts: [ARTIFACT_ROW], notes: [] };
    const adapter = new SupabaseLamplightAdapter(makeProvClient(backend));
    const prov = await adapter.getArtifactProvenance('u1', 'daily_devotion', '2026-08-07');
    expect(prov).toEqual({
      noteIds: ['n1', 'n2'],
      verses: ['Psalm 23:4'],
      librarySources: [{ chunkId: 'lc1', sourceId: 'treasury-of-david', heading: 'Psalm 23:4' }],
      modelUsed: 'gpt-5.6-terra',
      promptVersion: 'daily-devotion-2026-08-06-v4',
    });
  });

  it('keeps librarySources null when the library never ran', async () => {
    const backend: ProvBackend = {
      artifacts: [{ ...ARTIFACT_ROW, source_library_chunks: null }],
      notes: [],
    };
    const adapter = new SupabaseLamplightAdapter(makeProvClient(backend));
    const prov = await adapter.getArtifactProvenance('u1', 'daily_devotion', '2026-08-07');
    expect(prov!.librarySources).toBeNull();
  });

  it('returns null when no artifact exists for that period', async () => {
    const backend: ProvBackend = { artifacts: [], notes: [] };
    const adapter = new SupabaseLamplightAdapter(makeProvClient(backend));
    expect(await adapter.getArtifactProvenance('u1', 'daily_devotion', '2026-08-07')).toBeNull();
  });

  it('works for reflections too — one type serves both surfaces', async () => {
    const backend: ProvBackend = {
      artifacts: [{ ...ARTIFACT_ROW, type: 'monthly_reflection', period_key: '2026-08' }],
      notes: [],
    };
    const adapter = new SupabaseLamplightAdapter(makeProvClient(backend));
    const prov = await adapter.getArtifactProvenance('u1', 'monthly_reflection', '2026-08');
    expect(prov!.verses).toEqual(['Psalm 23:4']);
  });

  it('tolerates missing provenance columns on an older row', async () => {
    const backend: ProvBackend = {
      artifacts: [{ user_id: 'u1', type: 'daily_devotion', period_key: '2026-08-07' }],
      notes: [],
    };
    const adapter = new SupabaseLamplightAdapter(makeProvClient(backend));
    const prov = await adapter.getArtifactProvenance('u1', 'daily_devotion', '2026-08-07');
    expect(prov).toEqual({
      noteIds: [], verses: [], librarySources: null, modelUsed: null, promptVersion: null,
    });
  });
});

describe('SupabaseLamplightAdapter.resolveNoteTitles', () => {
  it('resolves ids to titles so the panel never renders a uuid at the reader', async () => {
    const backend: ProvBackend = {
      artifacts: [],
      notes: [{ id: 'n1', title: 'On rest' }, { id: 'n2', title: 'Weariness' }],
    };
    const adapter = new SupabaseLamplightAdapter(makeProvClient(backend));
    const titles = await adapter.resolveNoteTitles(['n1', 'n2']);
    expect(titles.get('n1')).toBe('On rest');
    expect(titles.get('n2')).toBe('Weariness');
  });

  it('falls back to (untitled) for a blank title rather than showing nothing', async () => {
    const backend: ProvBackend = { artifacts: [], notes: [{ id: 'n1', title: '   ' }] };
    const adapter = new SupabaseLamplightAdapter(makeProvClient(backend));
    expect((await adapter.resolveNoteTitles(['n1'])).get('n1')).toBe('(untitled)');
  });

  it('does not query at all for an empty id list', async () => {
    const backend: ProvBackend = { artifacts: [], notes: [] };
    const adapter = new SupabaseLamplightAdapter(makeProvClient(backend));
    expect((await adapter.resolveNoteTitles([])).size).toBe(0);
    expect(backend.lastIn).toBeUndefined();
  });

  it('omits ids that no longer resolve — a deleted note is simply absent', async () => {
    const backend: ProvBackend = { artifacts: [], notes: [{ id: 'n1', title: 'Kept' }] };
    const adapter = new SupabaseLamplightAdapter(makeProvClient(backend));
    const titles = await adapter.resolveNoteTitles(['n1', 'gone']);
    expect(titles.has('gone')).toBe(false);
    expect(titles.get('n1')).toBe('Kept');
  });
});
