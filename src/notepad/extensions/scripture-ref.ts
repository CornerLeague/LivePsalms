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
import { matchReferenceBeforeCursor, matchVersePickerBeforeCursor, matchLookupPickerBeforeCursor } from './scripture-ref-matchers';
import { renderVerseSuggestList } from './verse-suggest-renderer';
import { ScriptureRefNodeView } from './ScriptureRefView';
import { renderBookPicker } from './book-picker-renderer';
import { applyVerseSelection } from './verse-picker-commands';
import type { BookOrVerseItem } from './book-matcher';
import { type BibleTranslation, DEFAULT_TRANSLATION } from '../bible/translations';

export interface ScriptureRefOptions {
  // null in tests / when search is unavailable; set in production wiring (Task 14).
  search: VerseSearchDeps | null;
  // The translation frozen onto nodes inserted via the picker. Captured at the
  // editor's mount and stamped at insert so a later preference change does not
  // retroactively rewrite already-inserted references.
  translation: BibleTranslation;
}

export interface ScriptureRefAttrs {
  osis: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number | null;
  translation: BibleTranslation;
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
  return mergeCandidates(pin, rows.map((r) => normalizeFtsRow(r)), []);
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
const LOOKUP_PICKER_KEY = new PluginKey('scriptureRefLookup');

export const ScriptureRef = Node.create<ScriptureRefOptions>({
  name: 'scriptureRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { search: null, translation: DEFAULT_TRANSLATION };
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
    // Freeze the active translation at the editor's mount; the picker stamps THIS
    // onto every inserted node so changing the preference later never rewrites
    // already-inserted references.
    const translation = this.options.translation;

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
          translation,
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
        const verse = VERSE_PICKER_KEY.getState(state) as { active?: boolean } | undefined;
        const lookup = LOOKUP_PICKER_KEY.getState(state) as { active?: boolean } | undefined;
        return !verse?.active && !lookup?.active;
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

    // C — /verse book typeahead. The custom matcher fires only on "/verse"; the
    // renderer (renderBookPicker) computes its own view from the query
    // (book list / hint / resolved verse), so `items` returns []. Selecting a
    // book autocompletes the text; selecting a resolved verse inserts a node —
    // both via applyVerseSelection.
    const verseCommand = ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: BookOrVerseItem }) =>
      applyVerseSelection(editor, range, props);

    const picker: SuggestionOptions<BookOrVerseItem, BookOrVerseItem> = {
      editor: this.editor,
      pluginKey: VERSE_PICKER_KEY,
      char: '/',
      allowSpaces: true,
      startOfLine: false,
      command: verseCommand,
      render: () => renderBookPicker(search),
      findSuggestionMatch: ({ $position }) => {
        const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼');
        const m = matchVersePickerBeforeCursor(textBefore);
        if (!m) return null;
        const blockStart = $position.start();
        return { range: { from: blockStart + m.from, to: blockStart + m.to }, query: m.query, text: m.query };
      },
      items: () => [],
    };

    // D — /lookup verse-text picker. This is the verse-text search that /verse
    // used to do (FTS + semantic + prefix), moved verbatim to its own command.
    const lookup: SuggestionOptions<VerseCandidate, VerseCandidate> = {
      editor: this.editor,
      pluginKey: LOOKUP_PICKER_KEY,
      char: '/',
      allowSpaces: true,
      startOfLine: false,
      command,
      render: () => renderVerseSuggestList(search, { command: 'lookup' }),
      findSuggestionMatch: ({ $position }) => {
        const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼');
        const m = matchLookupPickerBeforeCursor(textBefore);
        if (!m) return null;
        const blockStart = $position.start();
        return { range: { from: blockStart + m.from, to: blockStart + m.to }, query: m.query, text: m.query };
      },
      items: ({ query }) => {
        if (!/^lookup/i.test(query)) return [];
        const stripped = query.replace(/^lookup\s*/i, '');
        return buildReferencePinItems(stripped);
      },
    };

    // Picker is registered FIRST so its plugin state is computed before the
    // predictive plugin's `apply` reads it via VERSE_PICKER_KEY.getState — that
    // ordering is what lets the predictive `allow` gate see a fresh (not stale)
    // picker.active and stand down on "/verse <ref>" instead of stacking a
    // second dropdown.
    return [Suggestion(picker), Suggestion(lookup), Suggestion(predictive)];
  },
});
