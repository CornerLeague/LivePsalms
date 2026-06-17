import type { Editor } from '@tiptap/core';
import type { BookOrVerseItem } from './book-matcher';

/**
 * Applies a /verse picker selection.
 * - A book item AUTOCOMPLETES: it rewrites the trigger range to "/verse <Book> "
 *   (trailing space) and leaves the cursor after it, so the picker's matcher
 *   re-fires and the dropdown moves into the "awaiting chapter:verse" state.
 * - A verse item INSERTS the scriptureRef node (delete the trigger range first).
 */
export function applyVerseSelection(
  editor: Editor,
  range: { from: number; to: number },
  item: BookOrVerseItem,
): void {
  if (item.kind === 'book') {
    editor.chain().focus().insertContentAt(range, `/verse ${item.book} `).run();
    return;
  }
  const c = item.candidate;
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
}
