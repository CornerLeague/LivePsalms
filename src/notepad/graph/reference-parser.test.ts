import { describe, it, expect } from 'vitest';
import {
  parseReferencesFromContent,
  toCanonicalScriptureId,
  parseVerseRef,
  findNoteLinkSnippet,
  walkNodes,
} from './reference-parser';

// ---------------------------------------------------------------------------
// Helper builders — construct minimal TipTap-shaped doc JSON without repeating
// the schema in every test.
// ---------------------------------------------------------------------------

type Mark = { type: string; attrs?: Record<string, unknown> };
type TextNode = { type: 'text'; text: string; marks?: Mark[] };
type ParagraphNode = { type: 'paragraph'; content?: Array<TextNode | ParagraphNode> };
type DocNode = { type: 'doc'; content?: Array<ParagraphNode | TextNode> };

function textNode(text: string, marks?: Mark[]): TextNode {
  const node: TextNode = { type: 'text', text };
  if (marks) node.marks = marks;
  return node;
}

function paragraph(...children: Array<TextNode | ParagraphNode>): ParagraphNode {
  return { type: 'paragraph', content: children };
}

function doc(...children: Array<ParagraphNode | TextNode>): DocNode {
  return { type: 'doc', content: children };
}

function makeDoc(...children: Array<ParagraphNode | TextNode>): string {
  return JSON.stringify(doc(...children));
}

function noteLinkMark(noteId: string): Mark {
  return { type: 'noteLink', attrs: { noteId } };
}

// ---------------------------------------------------------------------------
// parseReferencesFromContent — empty / malformed input
// ---------------------------------------------------------------------------

describe('parseReferencesFromContent — empty / malformed input', () => {
  it('returns empty edges and scriptureRefs for empty string content', () => {
    const result = parseReferencesFromContent('note-1', '');
    expect(result).toEqual({ edges: [], scriptureRefs: [] });
  });

  it('treats non-JSON content as empty input', () => {
    const result = parseReferencesFromContent('note-1', 'this is not json');
    expect(result).toEqual({ edges: [], scriptureRefs: [] });
  });

  it('returns empty result for well-formed JSON with no marks or text', () => {
    const content = makeDoc(paragraph());
    const result = parseReferencesFromContent('note-1', content);
    expect(result).toEqual({ edges: [], scriptureRefs: [] });
  });

  it('treats malformed JSON (trailing comma) as empty input without throwing', () => {
    expect(() =>
      parseReferencesFromContent('note-1', '{"type":"doc",}')
    ).not.toThrow();
    const result = parseReferencesFromContent('note-1', '{"type":"doc",}');
    expect(result).toEqual({ edges: [], scriptureRefs: [] });
  });
});

// ---------------------------------------------------------------------------
// parseReferencesFromContent — explicit noteLink extraction
// ---------------------------------------------------------------------------

describe('parseReferencesFromContent — explicit noteLink edges', () => {
  it('extracts one explicit edge from a single noteLink mark', () => {
    const content = makeDoc(
      paragraph(textNode('see here', [noteLinkMark('note-abc')]))
    );
    const { edges } = parseReferencesFromContent('note-1', content);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ target: 'note-abc', type: 'explicit', weight: 1.0 });
  });

  it('finds noteLink marks nested inside deeper content arrays (depth 2+)', () => {
    const inner = paragraph(textNode('deep link', [noteLinkMark('note-deep')]));
    const outer = paragraph(inner as unknown as TextNode);
    const content = makeDoc(outer);
    const { edges } = parseReferencesFromContent('note-1', content);
    expect(edges).toHaveLength(1);
    expect(edges[0].target).toBe('note-deep');
    expect(edges[0].type).toBe('explicit');
  });

  it('ignores a noteLink mark that is missing attrs.noteId', () => {
    const markWithoutId: Mark = { type: 'noteLink', attrs: {} };
    const content = makeDoc(
      paragraph(textNode('broken link', [markWithoutId]))
    );
    const { edges } = parseReferencesFromContent('note-1', content);
    expect(edges).toHaveLength(0);
  });

  it('ignores a noteLink mark that has no attrs at all', () => {
    const markNoAttrs: Mark = { type: 'noteLink' };
    const content = makeDoc(
      paragraph(textNode('no attrs', [markNoAttrs]))
    );
    const { edges } = parseReferencesFromContent('note-1', content);
    expect(edges).toHaveLength(0);
  });

  it('deduplicates two noteLink marks targeting the same noteId into one edge', () => {
    const content = makeDoc(
      paragraph(
        textNode('first ref', [noteLinkMark('note-dup')]),
        textNode(' and second ref', [noteLinkMark('note-dup')])
      )
    );
    const { edges } = parseReferencesFromContent('note-1', content);
    const explicitEdges = edges.filter((e) => e.type === 'explicit');
    expect(explicitEdges).toHaveLength(1);
    expect(explicitEdges[0].target).toBe('note-dup');
  });

  it('produces two edges for two noteLink marks targeting different noteIds', () => {
    const content = makeDoc(
      paragraph(
        textNode('link A', [noteLinkMark('note-aaa')]),
        textNode(' link B', [noteLinkMark('note-bbb')])
      )
    );
    const { edges } = parseReferencesFromContent('note-1', content);
    const explicitEdges = edges.filter((e) => e.type === 'explicit');
    expect(explicitEdges).toHaveLength(2);
    const targets = explicitEdges.map((e) => e.target).sort();
    expect(targets).toEqual(['note-aaa', 'note-bbb']);
  });
});

// ---------------------------------------------------------------------------
// parseReferencesFromContent — scripture references via regex
// ---------------------------------------------------------------------------

describe('parseReferencesFromContent — scripture_reference edges', () => {
  it('produces one scripture_reference edge for plain text containing "Romans 8:28"', () => {
    const content = makeDoc(paragraph(textNode('Romans 8:28 is a great verse')));
    const { edges, scriptureRefs } = parseReferencesFromContent('note-1', content);

    const scriptureEdges = edges.filter((e) => e.type === 'scripture_reference');
    expect(scriptureEdges).toHaveLength(1);
    expect(scriptureEdges[0].target).toBe(toCanonicalScriptureId('Romans 8:28'));
    expect(scriptureEdges[0].weight).toBe(0.9);

    expect(scriptureRefs).toHaveLength(1);
    expect(scriptureRefs[0]).toEqual({
      id: toCanonicalScriptureId('Romans 8:28'),
      ref: 'Romans 8:28',
    });
  });

  it('produces one edge per unique verse when multiple distinct verses appear', () => {
    const content = makeDoc(
      paragraph(textNode('Romans 8:28 and John 3:16 are both well known'))
    );
    const { edges, scriptureRefs } = parseReferencesFromContent('note-1', content);

    const scriptureEdges = edges.filter((e) => e.type === 'scripture_reference');
    expect(scriptureEdges).toHaveLength(2);
    expect(scriptureRefs).toHaveLength(2);

    const targets = scriptureEdges.map((e) => e.target);
    expect(targets).toContain(toCanonicalScriptureId('Romans 8:28'));
    expect(targets).toContain(toCanonicalScriptureId('John 3:16'));
  });

  it('deduplicates the same verse appearing twice in a document', () => {
    const content = makeDoc(
      paragraph(
        textNode('Read Romans 8:28. Romans 8:28 says that all things work together for good.')
      )
    );
    const { edges, scriptureRefs } = parseReferencesFromContent('note-1', content);

    const scriptureEdges = edges.filter((e) => e.type === 'scripture_reference');
    expect(scriptureEdges).toHaveLength(1);
    expect(scriptureRefs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// toCanonicalScriptureId — stability across abbreviation variants
// ---------------------------------------------------------------------------

describe('toCanonicalScriptureId — id stability', () => {
  it('produces the same id for "Romans 8:28", "Rom 8:28", and "Ro 8:28"', () => {
    const full = toCanonicalScriptureId('Romans 8:28');
    const abbrev = toCanonicalScriptureId('Rom 8:28');
    const shortest = toCanonicalScriptureId('Ro 8:28');
    expect(full).toBe(abbrev);
    expect(abbrev).toBe(shortest);
  });

  it('produces the same id for "Psalms 23:1", "Psalm 23:1", and "Ps 23:1"', () => {
    const plural = toCanonicalScriptureId('Psalms 23:1');
    const singular = toCanonicalScriptureId('Psalm 23:1');
    const abbrev = toCanonicalScriptureId('Ps 23:1');
    expect(plural).toBe(singular);
    expect(singular).toBe(abbrev);
  });

  it('produces a deterministic id for range form "Ps 23:1-6" (stable, not scripture:unknown)', () => {
    const id = toCanonicalScriptureId('Ps 23:1-6');
    expect(id).not.toBe('scripture:unknown');
    // Calling again must return the same value
    expect(toCanonicalScriptureId('Ps 23:1-6')).toBe(id);
  });

  it('returns "scripture:unknown" for nonsense input', () => {
    expect(toCanonicalScriptureId('garbage input')).toBe('scripture:unknown');
    expect(toCanonicalScriptureId('')).toBe('scripture:unknown');
    expect(toCanonicalScriptureId('Romans')).toBe('scripture:unknown');
  });

  it('produces the expected abbreviated form for "Romans 8:28" (scripture:ro-8-28)', () => {
    // Assert the concrete id so regressions are visible in test output
    expect(toCanonicalScriptureId('Romans 8:28')).toBe('scripture:ro-8-28');
  });

  it('produces the expected abbreviated form for "Ps 23:1-6" (scripture:ps-23-1)', () => {
    expect(toCanonicalScriptureId('Ps 23:1-6')).toBe('scripture:ps-23-1');
  });
});

// ---------------------------------------------------------------------------
// parseVerseRef — ranges and basic parsing
// ---------------------------------------------------------------------------

describe('parseVerseRef', () => {
  it('parses a verse range "Ps 23:1-6" with book "Psalms" and verseEnd set', () => {
    const result = parseVerseRef('Ps 23:1-6');
    expect(result).not.toBeNull();
    expect(result!.book).toBe('Psalms');
    expect(result!.chapter).toBe(23);
    expect(result!.verseStart).toBe(1);
    expect(result!.verseEnd).toBe(6);
  });

  it('parses "Psalms 23:1-6" with verseEnd set and book "Psalms"', () => {
    const result = parseVerseRef('Psalms 23:1-6');
    expect(result).not.toBeNull();
    expect(result!.book).toBe('Psalms');
    expect(result!.chapter).toBe(23);
    expect(result!.verseStart).toBe(1);
    expect(result!.verseEnd).toBe(6);
  });

  it('parses "Romans 8:28" with verseEnd null', () => {
    const result = parseVerseRef('Romans 8:28');
    expect(result).not.toBeNull();
    expect(result!.book).toBe('Romans');
    expect(result!.chapter).toBe(8);
    expect(result!.verseStart).toBe(28);
    expect(result!.verseEnd).toBeNull();
  });

  it('returns null for non-verse garbage input', () => {
    expect(parseVerseRef('garbage')).toBeNull();
    expect(parseVerseRef('')).toBeNull();
    expect(parseVerseRef('Romans')).toBeNull();
  });

  it('returns the correct canonical book name for "Rom 8:28"', () => {
    const result = parseVerseRef('Rom 8:28');
    expect(result).not.toBeNull();
    expect(result!.book).toBe('Romans');
  });
});

// ---------------------------------------------------------------------------
// parseReferencesFromContent — combined doc (both noteLink and scripture)
// ---------------------------------------------------------------------------

describe('parseReferencesFromContent — combined noteLink and scripture in one doc', () => {
  it('returns both an explicit edge and a scripture_reference edge from a combined doc', () => {
    const content = makeDoc(
      paragraph(
        textNode('linked note', [noteLinkMark('note-xyz')]),
        textNode(' see also Romans 8:28 for context')
      )
    );
    const { edges, scriptureRefs } = parseReferencesFromContent('note-1', content);

    const explicitEdges = edges.filter((e) => e.type === 'explicit');
    const scriptureEdges = edges.filter((e) => e.type === 'scripture_reference');

    expect(explicitEdges).toHaveLength(1);
    expect(explicitEdges[0].target).toBe('note-xyz');
    expect(explicitEdges[0].weight).toBe(1.0);

    expect(scriptureEdges).toHaveLength(1);
    expect(scriptureEdges[0].target).toBe(toCanonicalScriptureId('Romans 8:28'));
    expect(scriptureEdges[0].weight).toBe(0.9);

    expect(scriptureRefs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findNoteLinkSnippet
// ---------------------------------------------------------------------------

describe('findNoteLinkSnippet — empty / malformed input', () => {
  it('returns null for empty content', () => {
    expect(findNoteLinkSnippet('', 'any-id')).toBeNull();
  });

  it('returns null for non-JSON content', () => {
    expect(findNoteLinkSnippet('plain text only', 'any-id')).toBeNull();
  });

  it('returns null when no noteLink mark targets the requested id', () => {
    const content = makeDoc(
      paragraph(textNode('linked elsewhere', [noteLinkMark('other-note')])),
    );
    expect(findNoteLinkSnippet(content, 'wanted-note')).toBeNull();
  });

  it('returns null for a doc with no marks at all', () => {
    const content = makeDoc(paragraph(textNode('just plain text')));
    expect(findNoteLinkSnippet(content, 'wanted-note')).toBeNull();
  });
});

describe('findNoteLinkSnippet — match cases', () => {
  it('wraps a short marked text in [brackets] inside surrounding block text', () => {
    const content = makeDoc(
      paragraph(
        textNode('See also '),
        textNode('that piece', [noteLinkMark('target')]),
        textNode(' for context.'),
      ),
    );
    const snippet = findNoteLinkSnippet(content, 'target');
    expect(snippet).toBe('See also [that piece] for context.');
  });

  it('truncates with ellipses when surrounding text exceeds the window', () => {
    const lead = 'a'.repeat(120);
    const tail = 'b'.repeat(120);
    const content = makeDoc(
      paragraph(
        textNode(lead),
        textNode('LINK', [noteLinkMark('target')]),
        textNode(tail),
      ),
    );
    const snippet = findNoteLinkSnippet(content, 'target', 30);
    expect(snippet).toMatch(/^…a{30}\[LINK\]b{30}…$/);
  });

  it('returns the snippet from the FIRST block containing a matching mark', () => {
    const content = makeDoc(
      paragraph(textNode('first paragraph, no link')),
      paragraph(
        textNode('here is '),
        textNode('the link', [noteLinkMark('target')]),
      ),
      paragraph(
        textNode('and another '),
        textNode('link', [noteLinkMark('target')]),
      ),
    );
    const snippet = findNoteLinkSnippet(content, 'target');
    expect(snippet).toBe('here is [the link]');
  });

  it('finds a noteLink mark nested deep inside content arrays', () => {
    const inner = paragraph(
      textNode('deep '),
      textNode('linked', [noteLinkMark('target')]),
    );
    const content = makeDoc(paragraph(inner));
    const snippet = findNoteLinkSnippet(content, 'target');
    expect(snippet).toBe('deep [linked]');
  });

  it('ignores noteLink marks that target a different noteId', () => {
    const content = makeDoc(
      paragraph(
        textNode('wrong target', [noteLinkMark('not-this-one')]),
      ),
      paragraph(
        textNode('right '),
        textNode('target text', [noteLinkMark('target')]),
      ),
    );
    const snippet = findNoteLinkSnippet(content, 'target');
    expect(snippet).toBe('right [target text]');
  });
});

// ---------------------------------------------------------------------------
// walkNodes + node-aware scriptureRef extraction
// ---------------------------------------------------------------------------

function docWithScriptureRef() {
  return JSON.stringify({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Meditating on ' },
        { type: 'scriptureRef', attrs: { osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null, translation: 'BSB', text: 'For God...' } },
      ],
    }],
  });
}

describe('walkNodes', () => {
  it('collects nodes of the given type', () => {
    const found = walkNodes(JSON.parse(docWithScriptureRef()), 'scriptureRef');
    expect(found).toHaveLength(1);
    expect((found[0].attrs as { osis: string }).osis).toBe('jhn.3.16');
  });
});

describe('parseReferencesFromContent — node-aware', () => {
  it('emits a scripture edge + ref from a scriptureRef node', () => {
    const { edges, scriptureRefs } = parseReferencesFromContent('note1', docWithScriptureRef());
    // toCanonicalScriptureId('John 3:16') === 'scripture:jn-3-16' (shortest John abbrev is "Jn")
    expect(scriptureRefs.map((s) => s.id)).toContain('scripture:jn-3-16');
    expect(edges.some((e) => e.type === 'scripture_reference' && e.target === 'scripture:jn-3-16')).toBe(true);
  });

  it('dedupes a verse that appears both in prose and as a node (counts once)', () => {
    const doc = JSON.parse(docWithScriptureRef());
    doc.content[0].content.push({ type: 'text', text: ' see John 3:16 again' });
    const { scriptureRefs } = parseReferencesFromContent('note1', JSON.stringify(doc));
    const johns = scriptureRefs.filter((s) => s.id === 'scripture:jn-3-16');
    expect(johns).toHaveLength(1);
  });

  it('dedupes an OSIS-book node (e.g. /verse FTS insert) with a prose mention', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See John 3:16 — ' },
          { type: 'scriptureRef', attrs: { osis: 'jhn.3.16', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: null, translation: 'BSB', text: 'For God...' } },
        ],
      }],
    };
    const { scriptureRefs } = parseReferencesFromContent('note1', JSON.stringify(doc));
    const johns = scriptureRefs.filter((s) => s.id === 'scripture:jn-3-16');
    expect(johns).toHaveLength(1);
    expect(scriptureRefs.some((s) => s.id === 'scripture:jhn-3-16')).toBe(false);
  });

  it('walkNodes finds a scriptureRef nested in a list', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'scriptureRef', attrs: { osis: 'rom.8.28', book: 'Romans', chapter: 8, verseStart: 28, verseEnd: null, translation: 'BSB', text: 'x' } }],
          }],
        }],
      }],
    };
    const found = walkNodes(doc, 'scriptureRef');
    expect(found).toHaveLength(1);
    const { scriptureRefs } = parseReferencesFromContent('n', JSON.stringify(doc));
    expect(scriptureRefs.some((s) => s.id === 'scripture:ro-8-28')).toBe(true);
  });
});
