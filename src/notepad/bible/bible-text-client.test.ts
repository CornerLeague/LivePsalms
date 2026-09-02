import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: null }));

import {
  fetchBibleText, clearBibleTextCache, bibleTextCacheSize, BIBLE_TEXT_CACHE_MAX,
  makeBibleTextInvoke, bibleTextErrorMessage,
} from './bible-text-client';
import type { InvokeFn } from './lamplight-chat-client';

const okInvoke = (verses: unknown = [{ verse: 1, text: 'a' }, { verse: 2, text: 'b' }]): ReturnType<typeof vi.fn> =>
  vi.fn(async () => ({ data: { ok: true, verses }, error: null }));

beforeEach(() => clearBibleTextCache());

describe('fetchBibleText', () => {
  it('invokes bible-text with the book, chapter and translation and maps the verses', async () => {
    const invoke = okInvoke();
    const res = await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: 23, translation: 'NLT' });
    expect(invoke).toHaveBeenCalledWith('bible-text', { body: { book: 'psa', chapter: 23, translation: 'NLT' } });
    expect(res).toEqual({ ok: true, verses: [{ verse: 1, text: 'a' }, { verse: 2, text: 'b' }] });
  });

  it('serves a repeat request from session memory without invoking again', async () => {
    const invoke = okInvoke();
    await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: 23, translation: 'NLT' });
    const again = await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: 23, translation: 'NLT' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(again.ok).toBe(true);
  });

  it('keys the cache by translation, so ESV and NLT never share a chapter', async () => {
    const invoke = okInvoke();
    await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: 23, translation: 'NLT' });
    await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: 23, translation: 'ESV' });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('hands out copies, so a caller cannot mutate the cached chapter', async () => {
    const invoke = okInvoke();
    await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: 23, translation: 'NLT' });
    const res = await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: 23, translation: 'NLT' });
    if (res.ok) res.verses[0].text = 'mutated';
    const fresh = await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: 23, translation: 'NLT' });
    expect(fresh.ok && fresh.verses[0].text).toBe('a');
  });

  it('caps the cache and evicts the oldest chapter first', async () => {
    const invoke = okInvoke();
    for (let ch = 1; ch <= BIBLE_TEXT_CACHE_MAX + 1; ch++) {
      await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: ch, translation: 'NLT' });
    }
    expect(bibleTextCacheSize()).toBe(BIBLE_TEXT_CACHE_MAX);
    await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: 1, translation: 'NLT' }); // evicted → refetch
    expect(invoke).toHaveBeenCalledTimes(BIBLE_TEXT_CACHE_MAX + 2);
  });

  it('passes the server reason through on ok:false and does not cache it', async () => {
    const invoke = vi.fn(async () => ({ data: { ok: false, reason: 'missing_key' }, error: null }));
    const res = await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: 23, translation: 'ESV' });
    expect(res).toEqual({ ok: false, reason: 'missing_key' });
    expect(bibleTextCacheSize()).toBe(0);
  });

  it('reports the invoke error message as the reason', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: { message: 'unauthorized' } }));
    expect(await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: 23, translation: 'NLT' }))
      .toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('treats a thrown invoke as a network failure', async () => {
    const invoke = vi.fn(async () => { throw new Error('offline'); });
    const res = await fetchBibleText(invoke as InvokeFn, { book: 'psa', chapter: 23, translation: 'NLT' });
    expect(res).toMatchObject({ ok: false, reason: expect.stringContaining('network') });
  });

  it('treats an empty or malformed verses payload as not_found', async () => {
    expect(await fetchBibleText(okInvoke([]) as InvokeFn, { book: 'psa', chapter: 23, translation: 'NLT' }))
      .toEqual({ ok: false, reason: 'not_found' });
    expect(await fetchBibleText(okInvoke([{ nope: 1 }]) as InvokeFn, { book: 'psa', chapter: 24, translation: 'NLT' }))
      .toEqual({ ok: false, reason: 'not_found' });
  });

  it('is unavailable without an invoke', async () => {
    expect(await fetchBibleText(null, { book: 'psa', chapter: 23, translation: 'NLT' })).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('makeBibleTextInvoke', () => {
  it('is null with no client', () => {
    expect(makeBibleTextInvoke(null)).toBeNull();
  });

  it('forwards the body and names 401 and 429; everything else is network', async () => {
    const mk = (status?: number, data: unknown = null) => ({
      functions: { invoke: vi.fn(async () => (status ? { data: null, error: { message: 'non-2xx', context: { status } } } : { data, error: null })) },
    });
    const good = mk(undefined, { ok: true });
    const inv = makeBibleTextInvoke(good as never)!;
    expect(await inv('bible-text', { body: { book: 'psa' } })).toEqual({ data: { ok: true }, error: null });
    expect(good.functions.invoke).toHaveBeenCalledWith('bible-text', { body: { book: 'psa' } });

    expect((await makeBibleTextInvoke(mk(401) as never)!('bible-text', { body: {} })).error?.message).toBe('unauthorized');
    expect((await makeBibleTextInvoke(mk(429) as never)!('bible-text', { body: {} })).error?.message).toBe('rate_limited');
    expect((await makeBibleTextInvoke(mk(500) as never)!('bible-text', { body: {} })).error?.message).toBe('network');
  });
});

describe('bibleTextErrorMessage', () => {
  it('names the translation and says what to do', () => {
    expect(bibleTextErrorMessage('missing_key', 'ESV')).toMatch(/English Standard Version.*isn't connected/);
    expect(bibleTextErrorMessage('rate_limited', 'NLT')).toMatch(/NLT.*busy/);
    expect(bibleTextErrorMessage('unauthorized', 'NLT')).toMatch(/Sign in/);
    expect(bibleTextErrorMessage('not_found', 'ESV')).toMatch(/No ESV text/);
    expect(bibleTextErrorMessage('network: boom', 'ESV')).toMatch(/Couldn't reach the ESV service/);
  });
});
