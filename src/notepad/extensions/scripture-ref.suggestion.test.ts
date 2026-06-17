// @vitest-environment jsdom
//
// Behavioral regression tests for the two ScriptureRef Suggestion plugins
// (predictive reference matcher B + /verse keyword picker C). These pin the
// fixes for two bugs the unit tests missed:
//   Bug 1 — both plugins active at once (stacked dropdowns) on "/verse <ref>".
//   Bug 2 — the picker triggering on ANY "/word", not just "/verse".
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ScriptureRef } from './scripture-ref';
import type { VerseSearchDeps } from '../bible/verse-search-types';

beforeAll(() => {
  // jsdom has no layout engine; the Suggestion renderer measures clientRect on
  // activation. Shim the measurement APIs so activation doesn't reject.
  const rect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} });
  // @ts-expect-error test shim
  Range.prototype.getClientRects = () => [];
  // @ts-expect-error test shim
  Range.prototype.getBoundingClientRect = rect;
  // @ts-expect-error test shim
  Element.prototype.getClientRects = () => [];
  // @ts-expect-error test shim
  Element.prototype.getBoundingClientRect = rect;
});

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

function deps(): VerseSearchDeps {
  return {
    ftsSearch: async () => [],
    prefixSearch: async () => [],
    semanticSearch: async () => [],
    resolvePericope: async () => null,
    fetchVerseText: async () => null,
  };
}

function makeEditor() {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, ScriptureRef.configure({ search: deps() })],
    content: '<p></p>',
  });
}

function suggestionState(ed: Editor, name: string): { active: boolean; query: string | null } | undefined {
  const plugin = ed.state.plugins.find((p: unknown) => (p as { key?: string }).key === name);
  if (!plugin) return undefined;
  const st = (plugin as { getState(s: unknown): unknown }).getState(ed.state) as { active?: boolean; query?: string | null } | undefined;
  return st ? { active: !!st.active, query: st.query ?? null } : undefined;
}

const PICKER = 'scriptureRefPicker$';
const PREDICTIVE = 'scriptureRefPredictive$';

function type(ed: Editor, text: string) {
  for (const ch of text) ed.commands.insertContent(ch);
}

describe('Bug 1 — predictive stands down while the /verse picker is active', () => {
  it('"/verse John 3:16" → ONLY the picker is active (no stacked dropdown)', () => {
    editor = makeEditor();
    type(editor, '/verse John 3:16');
    expect(suggestionState(editor, PICKER)?.active).toBe(true);
    expect(suggestionState(editor, PREDICTIVE)?.active).toBe(false);
  });
});

describe('Bug 2 — picker only triggers on the /verse keyword', () => {
  it('"/todo" does NOT open the verse picker', () => {
    editor = makeEditor();
    type(editor, '/todo');
    expect(suggestionState(editor, PICKER)?.active).toBe(false);
  });

  it('"note /h" (space-prefixed slash word) does NOT open the verse picker', () => {
    editor = makeEditor();
    type(editor, 'note /h');
    expect(suggestionState(editor, PICKER)?.active).toBe(false);
  });
});

describe('follow-up #1 — predictive aborts stale in-flight fetches', () => {
  it('a changing reference query aborts the prior fetchVerseText signal', async () => {
    const signals: AbortSignal[] = [];
    const capturing: VerseSearchDeps = {
      ftsSearch: async () => [],
      prefixSearch: async () => [],
      semanticSearch: async () => [],
      resolvePericope: async () => null,
      fetchVerseText: async (_ref, opts) => {
        if (opts?.signal) signals.push(opts.signal);
        return null;
      },
    };
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, ScriptureRef.configure({ search: capturing })],
      content: '<p></p>',
    });
    // Typing through "...3:1" then "...3:16" makes the predictive plugin re-query
    // for two distinct parseable references → a second fetch that aborts the first.
    type(editor, 'John 3:16');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(signals.length).toBeGreaterThanOrEqual(2);
    // Every fetch before the latest must have been aborted by the next keystroke.
    expect(signals.slice(0, -1).every((s) => s.aborted)).toBe(true);
    expect(signals[signals.length - 1].aborted).toBe(false);
  });
});

describe('regression guard — intended flows still work', () => {
  it('"/verse love" opens the picker with the verse-prefixed query', () => {
    editor = makeEditor();
    type(editor, '/verse love');
    const picker = suggestionState(editor, PICKER);
    expect(picker?.active).toBe(true);
    expect(picker?.query).toBe('verse love');
  });

  it('a reference typed in prose ("see John 3:16") activates the predictive plugin', () => {
    editor = makeEditor();
    type(editor, 'see John 3:16');
    expect(suggestionState(editor, PREDICTIVE)?.active).toBe(true);
    expect(suggestionState(editor, PICKER)?.active).toBe(false);
  });
});

const LOOKUP = 'scriptureRefLookup$';

describe('/lookup picker (verse-text search moved here)', () => {
  it('"/lookup these" opens the lookup picker with the lookup-prefixed query', () => {
    editor = makeEditor();
    type(editor, '/lookup these');
    const lookup = suggestionState(editor, LOOKUP);
    expect(lookup?.active).toBe(true);
    expect(lookup?.query).toBe('lookup these');
  });

  it('predictive stands down while the /lookup picker is active', () => {
    editor = makeEditor();
    type(editor, '/lookup John 3:16');
    expect(suggestionState(editor, LOOKUP)?.active).toBe(true);
    expect(suggestionState(editor, PREDICTIVE)?.active).toBe(false);
  });

  it('"/verse" does NOT open the lookup picker', () => {
    editor = makeEditor();
    type(editor, '/verse love');
    expect(suggestionState(editor, LOOKUP)?.active).toBe(false);
  });
});

import { applyVerseSelection } from './verse-picker-commands';

describe('/verse book picker', () => {
  it('"/verse rom" keeps the picker active with the verse-prefixed query', () => {
    editor = makeEditor();
    type(editor, '/verse rom');
    const picker = suggestionState(editor, PICKER);
    expect(picker?.active).toBe(true);
    expect(picker?.query).toBe('verse rom');
  });

  it('selecting a book autocompletes the text to "/verse Romans " and keeps the picker open', () => {
    editor = makeEditor();
    type(editor, '/verse rom');
    const before = suggestionState(editor, PICKER);
    expect(before?.active).toBe(true);
    // The Suggestion range for "/verse rom" spans the whole trigger run. Drive
    // the documented select action directly against that range.
    const to = editor.state.selection.from;
    const from = to - '/verse rom'.length;
    applyVerseSelection(editor, { from, to }, { kind: 'book', book: 'Romans' });
    expect(editor.getText()).toContain('/verse Romans ');
    // Still a /verse trigger → picker stays active (now in the hint state).
    expect(suggestionState(editor, PICKER)?.active).toBe(true);
  });

  it('"/verse John 3:16" activates only the picker (predictive stands down)', () => {
    editor = makeEditor();
    type(editor, '/verse John 3:16');
    expect(suggestionState(editor, PICKER)?.active).toBe(true);
    expect(suggestionState(editor, PREDICTIVE)?.active).toBe(false);
  });
});
