import { useEffect, useMemo, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { toast } from 'sonner';
import '../scan/scan.css';
import { signedScanUrl, markTranscriptionSaved, discardScan } from '../scan/transcription-client';
import { buildNoteFromTranscriptionDoc } from '../scan/build-note-from-transcription';
import { locateUncertainSpans, uncertainDecorationPlugin, uncertainPluginKey } from '../scan/uncertain-decoration';
import { linkNotesByVerses } from '../import/document-importer';
import { emitOnboardingEvent } from '../onboarding/onboarding-events';
import type { TranscriptionResult } from '../scan/types';
import type { Note } from '../types';

interface Props {
  result: TranscriptionResult;
  folderId: string;
  persistNotes: (notes: Note[]) => Promise<void>;
  onSaved: (note: Note) => void;
  onDiscarded: () => void;
}

export function TranscriptionReview({ result, folderId, persistNotes, onSaved, onDiscarded }: Props) {
  const [title, setTitle] = useState(`Scanned note · ${new Date().toLocaleDateString()}`);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [saving, setSaving] = useState(false);

  const spans = useMemo(
    () => locateUncertainSpans(result.transcription, result.uncertainWords),
    [result.transcription, result.uncertainWords],
  );

  // FIX 2: seed a valid doc (≥1 block) — empty transcription would produce
  // { type:'doc', content:[] } which violates ProseMirror's block+ schema.
  const editor = useEditor({
    extensions: [StarterKit],
    content: (() => {
      const paras = result.transcription.split(/\n\n+/).filter(Boolean).map((p) => ({
        type: 'paragraph', content: [{ type: 'text', text: p }],
      }));
      return { type: 'doc', content: paras.length ? paras : [{ type: 'paragraph' }] };
    })(),
  });

  // FIX 1: return a cleanup that unregisters the plugin to prevent StrictMode
  // double-register crash ("Adding different instances of a keyed plugin").
  useEffect(() => {
    if (!editor) return;
    editor.registerPlugin(uncertainDecorationPlugin(spans));
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(uncertainPluginKey);
    };
  }, [editor, spans]);

  useEffect(() => {
    let active = true;
    signedScanUrl(result.imageKey).then((url) => {
      if (!active) return;
      if (url) {
        setImageUrl(url);
      } else {
        setImageError(true);
      }
    });
    return () => { active = false; };
  }, [result.imageKey]);

  // Route save through the full import pipeline (importNote + refetchAll + syncAll)
  // so the note appears in the sidebar without a reload.
  async function handleSave() {
    if (!editor) return;
    setSaving(true);
    try {
      const note = buildNoteFromTranscriptionDoc({
        title,
        doc: editor.getJSON(),
        plainText: editor.getText(),
        folderId,
        autoDetectVerses: true,
      });
      const [linked] = linkNotesByVerses([note]);
      const toSave = linked ?? note;
      await persistNotes([toSave]);                 // runs importNote + refetchAll + syncAll
      await markTranscriptionSaved(result.transcription_id, toSave.id); // id is preserved by importNote
      emitOnboardingEvent('scan-completed');
      onSaved(toSave);
    } catch {
      toast.error('Failed to save note — please try again.');
      setSaving(false);
    }
  }

  // FIX 4b: guard with saving + error feedback
  async function handleDiscard() {
    setSaving(true);
    try {
      await discardScan(result.imageKey, result.transcription_id);
      onDiscarded();
    } catch {
      toast.error("Couldn't discard — please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="transcription-review">
      <div className="transcription-review__panes">
        <figure className="transcription-review__image">
          {/* FIX 4c: imageError state for stuck "Loading image…" spinner */}
          {imageUrl
            ? <img src={imageUrl} alt="Your scanned note" />
            : imageError
              ? <p className="transcription-review__image-error">Couldn't load the original image.</p>
              : <div aria-busy="true">Loading image…</div>}
        </figure>
        <div className="transcription-review__text">
          <label className="transcription-review__field-label" htmlFor="scan-note-title">
            Title
          </label>
          <input
            id="scan-note-title"
            className="transcription-review__title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Note title"
          />
          {result.confidence < 0.6 && (
            <p className="transcription-review__low-conf" role="note">
              This handwriting was hard to read — please check it against the image.
            </p>
          )}
          <EditorContent editor={editor} />
          {result.verseFlags.length > 0 && (
            <ul className="transcription-review__verse-flags">
              {/* FIX 5: use index in key to avoid duplicate-key warnings if a ref repeats */}
              {result.verseFlags.map((f, i) => (
                <li key={`${f.ref}-${i}`} className={f.status === 'found' ? 'is-found' : 'is-missing'}>
                  {f.status === 'found'
                    ? <span title={f.canonicalText}>{f.ref} ✓</span>
                    : <span>{f.ref} — couldn't find this, check the photo</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="transcription-review__actions">
        <button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save note'}</button>
        <button onClick={handleDiscard} disabled={saving}>Discard</button>
      </div>
    </div>
  );
}
