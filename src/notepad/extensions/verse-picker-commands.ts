import type { Editor } from '@tiptap/core';
import type { BookOrVerseItem } from './book-matcher';
import { scriptureRefAttrsFromCandidate } from './scripture-ref';
import type { BibleTranslation } from '../bible/translations';

/**
 * Applies a /verse picker selection.
 * - A book item AUTOCOMPLETES the trigger text to "/verse <Book> ".
 * - A verse item INSERTS the scriptureRef node, stamping the ACTIVE translation
 *   (freeze-at-insert) — never a hardcoded value.
 */
export function applyVerseSelection(
  editor: Editor,
  range: { from: number; to: number },
  item: BookOrVerseItem,
  translation: BibleTranslation,
): void {
  if (item.kind === 'book') {
    editor.chain().focus().insertContentAt(range, `/verse ${item.book} `).run();
    return;
  }
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertScriptureRef(scriptureRefAttrsFromCandidate(item.candidate, translation))
    .run();
}
