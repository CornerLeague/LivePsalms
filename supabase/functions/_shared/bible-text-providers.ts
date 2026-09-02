// Publisher APIs for the api-sourced translations, normalized to verse rows.
//
// This is the whole of the server's contact with Tyndale (NLT) and Crossway
// (ESV). Nothing here touches Postgres, and nothing may: the ESV free licence
// forbids storing more than 500 verses locally, so text goes straight back to
// the browser, which caches it only in session memory (bible-text-client.ts).
//
// The provider table is keyed by translation id because each publisher has a
// different wire format — that is a registry, not an `if (id === 'ESV')`. The
// shell (bible-text/index.ts) and every client consumer branch on
// TranslationInfo.source, never on the id.
//
// Failure is a value, not a throw: the shell returns these `ok: false` reasons
// with HTTP 200 so supabase-js hands the client the reason instead of a
// generic non-2xx error, and the reader can show a retry state with words.

import { normalizeEsvPassages, type NormalizedVerse } from './esv-normalize.ts';
import { normalizeNltHtml } from './nlt-normalize.ts';
import { NLT_BOOKS } from './nlt-book-codes.ts';
import { osisToBookName } from './verse-verify.ts';

export const API_TRANSLATIONS = ['NLT', 'ESV'] as const;
export type ApiTranslation = (typeof API_TRANSLATIONS)[number];

export function isApiTranslation(v: unknown): v is ApiTranslation {
  return typeof v === 'string' && (API_TRANSLATIONS as readonly string[]).includes(v);
}

export type BibleTextFailure =
  | 'missing_key'     // provider needs a key this deployment has not set (or it was rejected)
  | 'rate_limited'    // provider answered 429 / the daily cap is spent
  | 'provider_error'  // provider unreachable, timed out, or answered with an error
  | 'not_found';      // provider answered, but with no verses for that book+chapter

export type BibleTextResult =
  | { ok: true; verses: NormalizedVerse[] }
  | { ok: false; reason: BibleTextFailure; detail?: string };

export interface ProviderDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  env: { get(key: string): string | undefined };
  /** Per-request timeout. Defaults to 10s; tests pass a small value. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

// Every decoration off except the "[n]" markers esv-normalize.ts keys on.
const ESV_PARAMS: Record<string, string> = {
  'include-passage-references': 'false',
  'include-headings': 'false',
  'include-footnotes': 'false',
  'include-short-copyright': 'false',
  'include-verse-numbers': 'true',
  'indent-poetry': 'false',
  'indent-paragraphs': '0',
};

function signalFor(deps: ProviderDeps): AbortSignal {
  return AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

function failure(reason: BibleTextFailure, detail?: string): BibleTextResult {
  return detail ? { ok: false, reason, detail } : { ok: false, reason };
}

/** ESV: api.esv.org, Token auth, JSON `{ passages: [blob] }`. Key required. */
export async function fetchEsvChapter(book: string, chapter: number, deps: ProviderDeps): Promise<BibleTextResult> {
  const key = deps.env.get('ESV_API_KEY');
  if (!key) return failure('missing_key');
  const name = osisToBookName(book);
  if (!name) return failure('not_found', `unknown book ${book}`);

  const params = new URLSearchParams({ q: `${name} ${chapter}`, ...ESV_PARAMS });
  let res: Response;
  try {
    res = await deps.fetch(`https://api.esv.org/v3/passage/text/?${params}`, {
      headers: { Authorization: `Token ${key}`, Accept: 'application/json' },
      signal: signalFor(deps),
    });
  } catch (err) {
    return failure('provider_error', String(err));
  }
  if (res.status === 401 || res.status === 403) return failure('missing_key', `esv ${res.status}`);
  if (res.status === 429) return failure('rate_limited');
  if (!res.ok) return failure('provider_error', `esv ${res.status}`);

  let body: { passages?: unknown };
  try { body = await res.json(); } catch { return failure('provider_error', 'esv bad json'); }
  const passages = Array.isArray(body.passages) ? body.passages.filter((p): p is string => typeof p === 'string') : [];
  const verses = normalizeEsvPassages(passages);
  return verses.length > 0 ? { ok: true, verses } : failure('not_found');
}

/** NLT: api.nlt.to, HTML body, anonymous `key=TEST` tier when no key is set. */
export async function fetchNltChapter(book: string, chapter: number, deps: ProviderDeps): Promise<BibleTextResult> {
  const entry = NLT_BOOKS[book];
  if (!entry) return failure('not_found', `unknown book ${book}`);
  const key = deps.env.get('NLT_API_KEY') || 'TEST';

  const params = new URLSearchParams({ ref: `${entry.ref}.${chapter}`, version: 'NLT', key });
  let res: Response;
  try {
    res = await deps.fetch(`https://api.nlt.to/api/passages?${params}`, { signal: signalFor(deps) });
  } catch (err) {
    return failure('provider_error', String(err));
  }
  if (res.status === 401 || res.status === 403) return failure('missing_key', `nlt ${res.status}`);
  if (res.status === 429) return failure('rate_limited');
  if (!res.ok) return failure('provider_error', `nlt ${res.status}`);

  const html = await res.text();
  const { verses, bookCode, chapter: answered } = normalizeNltHtml(html);
  if (verses.length === 0) return failure('not_found');
  // The API answers 200 with something rather than an error when the ref is
  // off: a near-miss book, or the book's LAST chapter for one past the end
  // (Psalm 151 → Psalm 150, seen live). Neither may render under the heading
  // that was asked for.
  if (bookCode && bookCode !== entry.code) return failure('not_found', `nlt answered ${bookCode} for ${book}`);
  if (answered !== null && answered !== chapter) return failure('not_found', `nlt answered chapter ${answered} for ${chapter}`);
  return { ok: true, verses };
}

const PROVIDERS: Record<ApiTranslation, (book: string, chapter: number, deps: ProviderDeps) => Promise<BibleTextResult>> = {
  NLT: fetchNltChapter,
  ESV: fetchEsvChapter,
};

/** One chapter of an api-sourced translation. `book` is the app's OSIS code. */
export function fetchChapter(
  translation: ApiTranslation,
  book: string,
  chapter: number,
  deps: ProviderDeps,
): Promise<BibleTextResult> {
  return PROVIDERS[translation](book, chapter, deps);
}
