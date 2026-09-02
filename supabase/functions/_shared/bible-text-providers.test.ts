import { describe, it, expect, vi } from 'vitest';
import { fetchChapter, fetchEsvChapter, fetchNltChapter, isApiTranslation, type ProviderDeps } from './bible-text-providers';

const NLT_PSALM_23 = `<html><body><div id="bibletext"><section><h2 class="bk_ch_vs_header">Psalm 23:1-6, NLT</h2>
<verse_export orig="psal_23_1" bk="psal" ch="23" vn="1"><p class="psa-title">A psalm of David.</p><p class="poet1-vn-sp"><span class="vn">1</span>The <span class="sc">Lord</span> is my shepherd;</p><p class="poet2">I have all that I need.</p></verse_export>
<verse_export orig="psal_23_2" bk="psal" ch="23" vn="2"><p class="poet1-vn"><span class="vn">2</span>He lets me rest in green meadows;</p></verse_export>
</section></div></body></html>`;

function deps(over: Partial<ProviderDeps> & { env?: Record<string, string> } = {}): ProviderDeps & { fetch: ReturnType<typeof vi.fn> } {
  const env = over.env ?? {};
  return {
    fetch: (over.fetch as ReturnType<typeof vi.fn>) ?? vi.fn(),
    env: { get: (k: string) => env[k] },
    timeoutMs: 50,
  };
}

const okResponse = (body: string | object, init: ResponseInit = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });

describe('isApiTranslation', () => {
  it('accepts NLT and ESV only', () => {
    expect(isApiTranslation('NLT')).toBe(true);
    expect(isApiTranslation('ESV')).toBe(true);
    expect(isApiTranslation('BSB')).toBe(false);
    expect(isApiTranslation(undefined)).toBe(false);
  });
});

describe('fetchNltChapter', () => {
  it('requests the NLT abbreviation with the anonymous key and normalizes the HTML', async () => {
    const fetch = vi.fn(async () => okResponse(NLT_PSALM_23));
    const res = await fetchNltChapter('psa', 23, deps({ fetch }));
    expect(res).toEqual({
      ok: true,
      verses: [
        { verse: 1, text: 'A psalm of David. The Lord is my shepherd; I have all that I need.' },
        { verse: 2, text: 'He lets me rest in green meadows;' },
      ],
    });
    const url = new URL(fetch.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://api.nlt.to/api/passages');
    expect(url.searchParams.get('ref')).toBe('Ps.23');
    expect(url.searchParams.get('version')).toBe('NLT');
    expect(url.searchParams.get('key')).toBe('TEST');
  });

  it('uses NLT_API_KEY when set', async () => {
    const fetch = vi.fn(async () => okResponse(NLT_PSALM_23));
    await fetchNltChapter('psa', 23, deps({ fetch, env: { NLT_API_KEY: 'real-key' } }));
    expect(new URL(fetch.mock.calls[0][0] as string).searchParams.get('key')).toBe('real-key');
  });

  it('reports not_found for an unknown book without calling the provider', async () => {
    const fetch = vi.fn();
    const res = await fetchNltChapter('sir', 1, deps({ fetch }));
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports not_found when the provider answers with no verses', async () => {
    const res = await fetchNltChapter('psa', 151, deps({ fetch: vi.fn(async () => okResponse('<html><body></body></html>')) }));
    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses a chapter past the end that the API answered with the last chapter', async () => {
    // Live behaviour: Psalm 151 is answered with Psalm 150's verse_exports.
    const lastChapter = NLT_PSALM_23.replaceAll('ch="23"', 'ch="150"');
    const res = await fetchNltChapter('psa', 151, deps({ fetch: vi.fn(async () => okResponse(lastChapter)) }));
    expect(res).toMatchObject({ ok: false, reason: 'not_found', detail: expect.stringContaining('150') });
  });

  it('refuses a chapter that came back under a different book code', async () => {
    const wrongBook = NLT_PSALM_23.replaceAll('bk="psal"', 'bk="prov"');
    const res = await fetchNltChapter('psa', 23, deps({ fetch: vi.fn(async () => okResponse(wrongBook)) }));
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('maps 429 to rate_limited, 5xx to provider_error, and a thrown fetch to provider_error', async () => {
    expect(await fetchNltChapter('psa', 23, deps({ fetch: vi.fn(async () => new Response('', { status: 429 })) })))
      .toEqual({ ok: false, reason: 'rate_limited' });
    expect(await fetchNltChapter('psa', 23, deps({ fetch: vi.fn(async () => new Response('', { status: 503 })) })))
      .toMatchObject({ ok: false, reason: 'provider_error' });
    expect(await fetchNltChapter('psa', 23, deps({ fetch: vi.fn(async () => { throw new Error('offline'); }) })))
      .toMatchObject({ ok: false, reason: 'provider_error', detail: expect.stringContaining('offline') });
  });
});

describe('fetchEsvChapter', () => {
  it('reports missing_key without calling the provider when ESV_API_KEY is unset', async () => {
    const fetch = vi.fn();
    const res = await fetchEsvChapter('psa', 23, deps({ fetch }));
    expect(res).toEqual({ ok: false, reason: 'missing_key' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the Token header, the book name, and the decoration-off params', async () => {
    const fetch = vi.fn(async () => okResponse({ passages: ['A Psalm of David.\n\n[1] The LORD is my shepherd; I shall not want.\n[2] He makes me lie down'] }));
    const res = await fetchEsvChapter('psa', 23, deps({ fetch, env: { ESV_API_KEY: 'k' } }));
    expect(res).toEqual({
      ok: true,
      verses: [
        { verse: 1, text: 'A Psalm of David. The LORD is my shepherd; I shall not want.' },
        { verse: 2, text: 'He makes me lie down' },
      ],
    });
    const [urlStr, init] = fetch.mock.calls[0] as [string, RequestInit];
    const url = new URL(urlStr);
    expect(url.origin + url.pathname).toBe('https://api.esv.org/v3/passage/text/');
    expect(url.searchParams.get('q')).toBe('Psalms 23');
    expect(url.searchParams.get('include-verse-numbers')).toBe('true');
    expect(url.searchParams.get('include-headings')).toBe('false');
    expect(url.searchParams.get('include-footnotes')).toBe('false');
    expect(url.searchParams.get('include-passage-references')).toBe('false');
    expect(url.searchParams.get('include-short-copyright')).toBe('false');
    expect(url.searchParams.get('indent-poetry')).toBe('false');
    expect(url.searchParams.get('indent-paragraphs')).toBe('0');
    expect((init.headers as Record<string, string>).Authorization).toBe('Token k');
  });

  it('treats a rejected key as missing_key and 429 as rate_limited', async () => {
    const env = { ESV_API_KEY: 'bad' };
    expect(await fetchEsvChapter('psa', 23, deps({ fetch: vi.fn(async () => new Response('', { status: 403 })), env })))
      .toMatchObject({ ok: false, reason: 'missing_key' });
    expect(await fetchEsvChapter('psa', 23, deps({ fetch: vi.fn(async () => new Response('', { status: 429 })), env })))
      .toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('reports not_found on an empty passages array and provider_error on bad JSON', async () => {
    const env = { ESV_API_KEY: 'k' };
    expect(await fetchEsvChapter('psa', 23, deps({ fetch: vi.fn(async () => okResponse({ passages: [] })), env })))
      .toEqual({ ok: false, reason: 'not_found' });
    expect(await fetchEsvChapter('psa', 23, deps({ fetch: vi.fn(async () => okResponse('not json')), env })))
      .toMatchObject({ ok: false, reason: 'provider_error' });
  });
});

describe('fetchChapter', () => {
  it('dispatches on the translation id through the registry', async () => {
    const fetch = vi.fn(async () => okResponse(NLT_PSALM_23));
    const res = await fetchChapter('NLT', 'psa', 23, deps({ fetch }));
    expect(res.ok).toBe(true);
    expect(fetch.mock.calls[0][0]).toContain('api.nlt.to');
  });
});
