import { describe, it, expect } from 'vitest';
import { normalizeNltHtml, stripNestedElement, decodeEntities } from './nlt-normalize';

// Captured verbatim from api.nlt.to/api/passages?ref=Psalm.23&version=NLT&key=TEST
// on 2026-09-02 (the anonymous tier). Six verses, a psalm title, an inline
// footnote in verse 4, small-caps LORD in 1 and 6, and a chapter heading.
const PSALM_23_NLT = ` <!DOCTYPE html><html lang="en-US">
                <head>
                <title>NLT API</title>
                <link rel="stylesheet" href="https://api.nlt.to/content/nlt-api-css?vers=1.04"/>
                </head>
                <body>
            <div id="bibletext" class=" NLT NLT BibleText section"><section><h2 class="bk_ch_vs_header">Psalm 23:1-6, NLT</h2><verse_export orig="psal_23_1" bk="psal" ch="23" vn="1">
<h3 class="chapter-number"><span class="cw">Psalm</span> <span class="cw_ch">23</span></h3>
<h4 class="subhead">The <span class="subhead-sc">Lord</span> Is My Shepherd</h4>
<p class="psa-title">A psalm of David.</p>
<p class="poet1-vn-sp"><span class="vn">1</span>The <span class="sc">Lord</span> is my shepherd;</p>
<p class="poet2">I have all that I need.</p>
</verse_export><verse_export orig="psal_23_2" bk="psal" ch="23" vn="2">
<p class="poet1-vn"><span class="vn">2</span>He lets me rest in green meadows;</p>
<p class="poet2">he leads me beside peaceful streams.</p>
</verse_export><verse_export orig="psal_23_3" bk="psal" ch="23" vn="3">
<p class="poet2-vn"><span class="vn">3</span>He renews my strength.</p>
<p class="poet1">He guides me along right paths,</p>
<p class="poet2">bringing honor to his name.</p>
</verse_export><verse_export orig="psal_23_4" bk="psal" ch="23" vn="4">
<p class="poet1-vn"><span class="vn">4</span>Even when I walk</p>
<p class="poet2">through the darkest valley,<a class="a-tn">*</a><span class="tn"><span class="tn-ref">23:4</span> Or <em>the dark valley of death.</em></span></p>
<p class="poet1">I will not be afraid,</p>
<p class="poet2">for you are close beside me.</p>
<p class="poet1">Your rod and your staff</p>
<p class="poet2">protect and comfort me.</p>
</verse_export><verse_export orig="psal_23_5" bk="psal" ch="23" vn="5">
<p class="poet1-vn"><span class="vn">5</span>You prepare a feast for me</p>
<p class="poet2">in the presence of my enemies.</p>
<p class="poet1">You honor me by anointing my head with oil.</p>
<p class="poet2">My cup overflows with blessings.</p>
</verse_export><verse_export orig="psal_23_6" bk="psal" ch="23" vn="6">
<p class="poet1-vn"><span class="vn">6</span>Surely your goodness and unfailing love will pursue me</p>
<p class="poet2">all the days of my life,</p>
<p class="poet1">and I will live in the house of the <span class="sc">Lord</span></p>
<p class="poet2">forever.</p>

</verse_export></section></div></body></html>`;

describe('normalizeNltHtml on the live Psalm 23 markup', () => {
  const { verses, bookCode } = normalizeNltHtml(PSALM_23_NLT);

  it('numbers six verses from the vn attribute', () => {
    expect(verses.map((v) => v.verse)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reports the book code and chapter the response carried', () => {
    expect(bookCode).toBe('psal');
    expect(normalizeNltHtml(PSALM_23_NLT).chapter).toBe(23);
  });

  it('fuses the psalm title into verse 1 and keeps small caps as plain text', () => {
    expect(verses[0].text).toBe('A psalm of David. The Lord is my shepherd; I have all that I need.');
  });

  it('drops the chapter heading and subhead entirely', () => {
    const all = verses.map((v) => v.text).join(' ');
    expect(all).not.toContain('Psalm 23');
    expect(all).not.toContain('Is My Shepherd');
  });

  it('concatenates every poetry line of a multi-paragraph verse', () => {
    expect(verses[2].text).toBe('He renews my strength. He guides me along right paths, bringing honor to his name.');
  });

  it('strips the verse-4 footnote marker and body', () => {
    expect(verses[3].text).toBe(
      'Even when I walk through the darkest valley, I will not be afraid, for you are close beside me. Your rod and your staff protect and comfort me.',
    );
    expect(verses[3].text).not.toContain('*');
    expect(verses[3].text).not.toContain('23:4');
    expect(verses[3].text).not.toContain('dark valley of death');
  });

  it('leaves no markup, verse-number digits, or doubled spaces in any verse', () => {
    for (const v of verses) {
      expect(v.text).not.toMatch(/[<>]/);
      expect(v.text).not.toMatch(/^\d/);
      expect(v.text).not.toMatch(/ {2}/);
      expect(v.text).toBe(v.text.trim());
    }
  });

  it('keeps the closing LORD of verse 6 as plain text', () => {
    expect(verses[5].text).toBe('Surely your goodness and unfailing love will pursue me all the days of my life, and I will live in the house of the Lord forever.');
  });
});

describe('normalizeNltHtml edge cases', () => {
  it('returns no verses for empty or unrelated HTML', () => {
    expect(normalizeNltHtml('')).toEqual({ verses: [], bookCode: null, chapter: null });
    expect(normalizeNltHtml('<html><body><p>Nothing</p></body></html>')).toEqual({ verses: [], bookCode: null, chapter: null });
  });

  it('keeps punctuation flush against an inline small-caps span', () => {
    // Live Psalm 150:1 — a stray space before "!" was the first live defect.
    const html = '<verse_export bk="psal" ch="150" vn="1"><p class="poet1-vn"><span class="vn">1</span>Praise the <span class="sc">Lord</span>!</p><p class="poet2">Praise God in his sanctuary;</p></verse_export>';
    expect(normalizeNltHtml(html).verses[0].text).toBe('Praise the Lord! Praise God in his sanctuary;');
  });

  it('skips a verse_export with no usable vn', () => {
    const html = '<verse_export bk="john" ch="1"><p>x</p></verse_export><verse_export bk="john" ch="1" vn="2"><p>y</p></verse_export>';
    expect(normalizeNltHtml(html).verses).toEqual([{ verse: 2, text: 'y' }]);
  });

  it('decodes entities and merges a repeated verse number', () => {
    const html =
      '<verse_export bk="john" ch="1" vn="1"><p>Alpha &amp; beta</p></verse_export>' +
      '<verse_export bk="john" ch="1" vn="1"><p>&#8220;gamma&#8221;</p></verse_export>';
    expect(normalizeNltHtml(html).verses).toEqual([{ verse: 1, text: 'Alpha & beta “gamma”' }]);
  });

  it('falls back to the raw text when a verse has no <p> blocks', () => {
    const html = '<verse_export bk="john" ch="1" vn="7">plain <em>text</em> here</verse_export>';
    expect(normalizeNltHtml(html).verses).toEqual([{ verse: 7, text: 'plain text here' }]);
  });
});

describe('stripNestedElement', () => {
  const open = /<span\b[^>]*\bclass="[^"]*\btn\b[^"]*"[^>]*>/i;

  it('removes a footnote span together with the spans nested inside it', () => {
    const html = 'a<span class="tn"><span class="tn-ref">1:1</span> note <em>x</em></span>b';
    expect(stripNestedElement(html, 'span', open)).toBe('ab');
  });

  it('removes every matching element and leaves unrelated spans alone', () => {
    const html = '<span class="sc">Lord</span><span class="tn">n1</span> mid <span class="tn">n2</span>';
    expect(stripNestedElement(html, 'span', open)).toBe('<span class="sc">Lord</span> mid ');
  });

  it('drops to end-of-input on an unclosed element rather than looping', () => {
    expect(stripNestedElement('a<span class="tn">never closed', 'span', open)).toBe('a');
  });
});

describe('decodeEntities', () => {
  it('handles named, decimal, and hex entities and leaves unknowns intact', () => {
    expect(decodeEntities('&lt;&amp;&gt; &#65;&#x42; &nbsp;x &bogus;')).toBe('<&> AB  x &bogus;');
  });
});
