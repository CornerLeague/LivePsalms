import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { VerseSearchDeps } from '../bible/verse-search-types';
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
});
