import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import type { VerseSearchDeps, VerseCandidate } from '../bible/verse-search-types';
import {
  completeReference,
  normalizeFtsRow,
  mergeCandidates,
  routeQuery,
  referenceCandidate,
} from '../bible/verse-search';
import { matchReferenceBeforeCursor, matchVersePickerBeforeCursor } from './scripture-ref-matchers';
import { renderVerseSuggestList } from './verse-suggest-renderer';
import { ScriptureRefNodeView } from './ScriptureRefView';

export interface ScriptureRefOptions {
  // null in tests / when search is unavailable; set in production wiring (Task 14).
  search: VerseSearchDeps | null;
}

export interface ScriptureRefAttrs {
  osis: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number | null;
  translation: 'BSB';
  text: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    scriptureRef: {
      insertScriptureRef: (attrs: ScriptureRefAttrs) => ReturnType;
    };
  }
}

function num(value: string | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function buildReferenceItems(
  query: string,
  search: VerseSearchDeps | null,
  signal: AbortSignal,
): Promise<VerseCandidate[]> {
  if (!search) return [];
  const c = await completeReference(query, search, { signal });
  return c ? [c] : [];
}

export async function buildKeywordItems(
  query: string,
  search: VerseSearchDeps | null,
  signal: AbortSignal,
): Promise<VerseCandidate[]> {
  if (!search) return [];
  // Instant FTS slice (plus a reference pin if the query parses as a ref) for the
  // synchronous `items` contract — this is the instant first paint. The live
  // /verse picker now upgrades the dropdown with semantic results after a
  // debounce via createVerseSearch in the renderer (see renderVerseSuggestList);
  // this builder stays the instant FTS slice + reference pin.
  const rows = await search.ftsSearch(query, { signal });
  const route = routeQuery(query);
  const pin = route.kind === 'reference' ? referenceCandidate(route.parsed, '') : null;
  return mergeCandidates(pin, rows.map(normalizeFtsRow), []);
}

// Pin-only instant items for the /verse picker (C). The picker's live results —
// FTS-instant then FTS+semantic — are owned by createVerseSearch in the renderer
// (see renderVerseSuggestList). Pinning just the local reference parse here lets
// the dropdown's first paint be instant WITHOUT issuing a second FTS request per
// keystroke (the renderer already fetches FTS). Synchronous + dependency-free,
// so it needs no AbortSignal. Returns [] for keyword queries — the renderer fills
// those a beat later.
export function buildReferencePinItems(query: string): VerseCandidate[] {
  const route = routeQuery(query);
  return route.kind === 'reference' ? [referenceCandidate(route.parsed, '')] : [];
}

const PREDICTIVE_KEY = new PluginKey('scriptureRefPredictive');
const VERSE_PICKER_KEY = new PluginKey('scriptureRefPicker');

export const ScriptureRef = Node.create<ScriptureRefOptions>({
  name: 'scriptureRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { search: null };
  },

  addAttributes() {
    return {
      osis: { default: null, parseHTML: (el) => el.getAttribute('data-osis'), renderHTML: (a) => ({ 'data-osis': a.osis }) },
      book: { default: null, parseHTML: (el) => el.getAttribute('data-book'), renderHTML: (a) => ({ 'data-book': a.book }) },
      chapter: { default: null, parseHTML: (el) => num(el.getAttribute('data-chapter')), renderHTML: (a) => ({ 'data-chapter': String(a.chapter) }) },
      verseStart: { default: null, parseHTML: (el) => num(el.getAttribute('data-verse-start')), renderHTML: (a) => ({ 'data-verse-start': String(a.verseStart) }) },
      verseEnd: { default: null, parseHTML: (el) => num(el.getAttribute('data-verse-end')), renderHTML: (a) => (a.verseEnd == null ? {} : { 'data-verse-end': String(a.verseEnd) }) },
      translation: { default: 'BSB', parseHTML: (el) => el.getAttribute('data-translation') ?? 'BSB', renderHTML: (a) => ({ 'data-translation': a.translation }) },
      text: { default: '', parseHTML: (el) => el.getAttribute('data-text') ?? '', renderHTML: (a) => ({ 'data-text': a.text }) },
    };
  },

  parseHTML() {
    return [{
      tag: 'span[data-scripture-ref]',
      // Reject malformed input: a node without a valid data-osis is not ours.
      getAttrs: (el) => (el instanceof HTMLElement && el.getAttribute('data-osis') ? null : false),
    }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as ScriptureRefAttrs;
    const range = a.verseEnd ? `${a.verseStart}–${a.verseEnd}` : `${a.verseStart}`;
    const label = `${a.book} ${a.chapter}:${range}`;
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-scripture-ref': '' }),
      label, // visible text is the reference label (aids HTML/clipboard extraction)
    ];
  },

  addCommands() {
    return {
      insertScriptureRef:
        (attrs) =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs }).run(),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ScriptureRefNodeView);
  },

  addProseMirrorPlugins() {
    const search = this.options.search;

    // Predictive (B) resolves each typed reference via fetchVerseText. Hold the
    // controller so a new keystroke aborts the prior in-flight request instead
    // of leaking it (each `items` call previously made a throwaway controller it
    // never aborted). completeReference swallows the resulting AbortError.
    let predictiveAbort: AbortController | null = null;

    const insertFromCandidate = (
      editor: Editor,
      range: { from: number; to: number },
      c: VerseCandidate,
    ): void => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertScriptureRef({
          osis: c.osis,
          book: c.book,
          chapter: c.chapter,
          verseStart: c.verseStart,
          verseEnd: c.verseEnd,
          translation: 'BSB',
          text: c.text,
        })
        .run();
    };

    const command = ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: VerseCandidate }) =>
      insertFromCandidate(editor, range, props);

    // B — predictive reference (no trigger char; book-pattern matcher).
    const predictive: SuggestionOptions<VerseCandidate, VerseCandidate> = {
      editor: this.editor,
      pluginKey: PREDICTIVE_KEY,
      char: '',
      command,
      // Stand down while the /verse picker (C) is active, otherwise both plugins
      // match `/verse John 3:16` and stack two dropdowns. The suggestion plugin's
      // internal state exposes a boolean `active` flag (see @tiptap/suggestion).
      allow: ({ state }) => {
        const pickerState = VERSE_PICKER_KEY.getState(state) as { active?: boolean } | undefined;
        return !pickerState?.active;
      },
      render: () => renderVerseSuggestList(),
      findSuggestionMatch: ({ $position }) => {
        const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼');
        const m = matchReferenceBeforeCursor(textBefore);
        if (!m) return null;
        const blockStart = $position.start();
        return { range: { from: blockStart + m.from, to: blockStart + m.to }, query: m.query, text: m.query };
      },
      items: ({ query }) => {
        predictiveAbort?.abort();
        predictiveAbort = new AbortController();
        return buildReferenceItems(query, search, predictiveAbort.signal);
      },
    };

    // C — /verse keyword picker. A custom matcher fires the picker ONLY on the
    // literal "/verse" command (not on every "/word"); the matcher's query keeps
    // the leading "verse" so items/renderer strip it exactly as before.
    const picker: SuggestionOptions<VerseCandidate, VerseCandidate> = {
      editor: this.editor,
      pluginKey: VERSE_PICKER_KEY,
      char: '/',
      allowSpaces: true,
      startOfLine: false,
      command,
      render: () => renderVerseSuggestList(search),
      findSuggestionMatch: ({ $position }) => {
        const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼');
        const m = matchVersePickerBeforeCursor(textBefore);
        if (!m) return null;
        const blockStart = $position.start();
        return { range: { from: blockStart + m.from, to: blockStart + m.to }, query: m.query, text: m.query };
      },
      items: ({ query }) => {
        if (!/^verse/i.test(query)) return [];
        const stripped = query.replace(/^verse\s*/i, '');
        // Pin only the local reference parse; createVerseSearch in the renderer
        // owns FTS + semantic for the picker, so we must NOT fetch FTS here too
        // (that was the double FTS request per keystroke). Synchronous, no signal.
        return buildReferencePinItems(stripped);
      },
    };

    // Picker is registered FIRST so its plugin state is computed before the
    // predictive plugin's `apply` reads it via VERSE_PICKER_KEY.getState — that
    // ordering is what lets the predictive `allow` gate see a fresh (not stale)
    // picker.active and stand down on "/verse <ref>" instead of stacking a
    // second dropdown.
    return [Suggestion(picker), Suggestion(predictive)];
  },
});
