// NLT API HTML → per-verse rows.
//
// api.nlt.to/api/passages answers with an HTML document, not JSON. The part we
// want is a run of <verse_export> elements, one per verse:
//
//   <verse_export orig="psal_23_4" bk="psal" ch="23" vn="4">
//   <p class="poet1-vn"><span class="vn">4</span>Even when I walk</p>
//   <p class="poet2">through the darkest valley,<a class="a-tn">*</a><span class="tn"><span class="tn-ref">23:4</span> Or <em>the dark valley of death.</em></span></p>
//   …
//   </verse_export>
//
// Rules, each pinned by a test:
//   - the verse number comes from @vn, never from the inline <span class="vn">;
//   - a verse is the space-joined text of its <p> blocks (poetry lines);
//   - footnotes are dropped: the <a class="a-tn"> marker and the
//     <span class="tn"> body, which nests further spans;
//   - <span class="sc">Lord</span> small caps survive as plain text;
//   - headings (<h2>/<h3>/<h4>) are dropped — the reader supplies its own —
//     but the psalm title <p class="psa-title"> is kept and fused into verse 1,
//     mirroring how BSB/KJV/WEB rows carry the superscription in verse 1.
//
// The tokenizer is a small hand-rolled tag walker: Deno's edge runtime has no
// DOM, and the markup is regular enough that a real HTML parser is not worth
// the dependency.

export interface NormalizedVerse {
  verse: number;
  text: string;
}

const VERSE_EXPORT = /<verse_export\b([^>]*)>([\s\S]*?)<\/verse_export>/gi;
const ATTR_VN = /\bvn="(\d+)"/i;
const ATTR_BK = /\bbk="([^"]*)"/i;
const ATTR_CH = /\bch="(\d+)"/i;
const P_BLOCK = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
const HEADING = /<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi;
const VERSE_NUMBER_SPAN = /<span\b[^>]*\bclass="[^"]*\bvn\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi;
const FOOTNOTE_MARK = /<a\b[^>]*\bclass="[^"]*\ba-tn\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
const TAG = /<[^>]+>/g;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Remove every element whose opening tag matches `open`, including nested
 * elements of the same tag name, so `<span class="tn"><span>…</span></span>`
 * goes in one piece. `open` must match only the opening tag, e.g.
 * /<span\b[^>]*class="[^"]*\btn\b[^"]*"[^>]*>/i, and `tag` is its tag name.
 */
export function stripNestedElement(html: string, tag: string, open: RegExp): string {
  const openRe = new RegExp(open.source, 'gi');
  const stepRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  let out = '';
  let cursor = 0;
  for (let m = openRe.exec(html); m; m = openRe.exec(html)) {
    if (m.index < cursor) continue; // inside a span we already removed
    out += html.slice(cursor, m.index);
    let depth = 1;
    let end = html.length;
    stepRe.lastIndex = m.index + m[0].length;
    for (let s = stepRe.exec(html); s; s = stepRe.exec(html)) {
      depth += s[1] === '/' ? -1 : 1;
      if (depth === 0) { end = s.index + s[0].length; break; }
    }
    cursor = end;
    openRe.lastIndex = end;
  }
  return out + html.slice(cursor);
}

const FOOTNOTE_BODY_OPEN = /<span\b[^>]*\bclass="[^"]*\btn\b[^"]*"[^>]*>/i;

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// Inline tags (<span class="sc">, <em>) sit flush against punctuation, so a
// tag becomes nothing, not a space — "the Lord!" must not read "the Lord !".
// Block boundaries get their space when the <p> texts are joined.
function textOf(fragment: string): string {
  return tidy(decodeEntities(fragment.replace(TAG, '')));
}

function verseText(inner: string): string {
  let html = inner.replace(HEADING, ' ');
  html = stripNestedElement(html, 'span', FOOTNOTE_BODY_OPEN);
  html = html.replace(FOOTNOTE_MARK, '').replace(VERSE_NUMBER_SPAN, '');
  const lines: string[] = [];
  P_BLOCK.lastIndex = 0;
  for (let m = P_BLOCK.exec(html); m; m = P_BLOCK.exec(html)) {
    const t = textOf(m[1]);
    if (t) lines.push(t);
  }
  // A verse with no <p> at all (never seen live) still yields its text.
  return lines.length > 0 ? lines.join(' ') : textOf(html);
}

export interface NltPassage {
  verses: NormalizedVerse[];
  /** The book code (verse_export/@bk) the response carried, if any. */
  bookCode: string | null;
  /**
   * The chapter (verse_export/@ch) the response carried, if any. The API
   * answers an out-of-range chapter with the book's LAST chapter rather than
   * an error — Psalm 151 comes back as Psalm 150 — so callers compare this to
   * what they asked for.
   */
  chapter: number | null;
}

/** Normalize one NLT passages response. Empty / unrecognised markup → no verses. */
export function normalizeNltHtml(html: string): NltPassage {
  const verses: NormalizedVerse[] = [];
  let bookCode: string | null = null;
  let chapter: number | null = null;
  if (!html) return { verses, bookCode, chapter };

  VERSE_EXPORT.lastIndex = 0;
  for (let m = VERSE_EXPORT.exec(html); m; m = VERSE_EXPORT.exec(html)) {
    const attrs = m[1];
    const vn = Number(ATTR_VN.exec(attrs)?.[1]);
    if (!Number.isInteger(vn) || vn < 1) continue;
    if (bookCode === null) bookCode = ATTR_BK.exec(attrs)?.[1]?.toLowerCase() ?? null;
    if (chapter === null) {
      const ch = Number(ATTR_CH.exec(attrs)?.[1]);
      if (Number.isInteger(ch) && ch >= 1) chapter = ch;
    }
    const text = verseText(m[2]);
    if (!text) continue;
    const prev = verses[verses.length - 1];
    if (prev && prev.verse === vn) { prev.text = tidy(`${prev.text} ${text}`); continue; }
    verses.push({ verse: vn, text });
  }
  return { verses, bookCode, chapter };
}
