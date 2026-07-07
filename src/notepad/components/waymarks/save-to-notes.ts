import type { NoteCollection } from '../../collection/note-collection';
import type { ReflectionRecord } from '../../storage/lamplight-adapter';

// Save-to-notes seam: reuse Notepad's existing note-create path, then write the letter into
// the new note. The adapter flag-flip (setReflectionSavedToNotes) is owned + tested in Task 17;
// this insert reuses existing collection code. Extracted from waymarks-routes.tsx so the
// handler is testable without importing the route module (whose @/lib/supabase import
// warns at module scope when env vars are missing).
export function buildSaveToNotesHandler(collection: NoteCollection) {
  return async (record: ReflectionRecord) => {
    // Idempotent retry: the component writes the note BEFORE the saved_to_notes flag,
    // so a failed flag write leaves a live button whose retry would re-insert. A
    // devotion note already carrying this letter's title means a prior attempt got
    // this far — skip the insert and let the caller proceed to the flag write.
    // (Title match is a heuristic: a renamed note means retry duplicates. Accepted.)
    const existing = collection
      .getSnapshot()
      .notes.find((n) => n.type === 'devotion' && n.title === record.title);
    if (existing) return;
    const note = await collection.createNote('root', 'devotion');
    const content = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: record.title }] },
        ...record.artifact.letter
          .split('\n\n')
          .filter((p) => p.length > 0)
          .map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
      ],
    });
    await collection.updateNote(note.id, { title: record.title, content });
  };
}
