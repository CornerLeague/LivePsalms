// supabase/functions/_shared/process-safety-job.ts
//
// The `note_safety` job: classify one note and record the verdict.
//
// A SEPARATE JOB KIND rather than a step inside `embedding_refresh`, and the
// reason is the retry lifecycle. If classification rode inside the embed job,
// a note whose embedding succeeded and whose classification failed would leave
// two bad options: fail the whole job and re-embed needlessly, or mark it done
// and leave the note **permanently unclassified** — which, because the gate
// fails closed, means permanently invisible to every AI surface. Its own kind
// gets its own retries.
//
// ⚠️ A ROW IS WRITTEN FOR EVERY NOTE, INCLUDING ORDINARY ONES. The gate reads a
// missing row as "withhold", so a job that only recorded concerning notes would
// silently withhold the entire product.
//
// ⚠️ AND A FAIL-CLOSED VERDICT IS NEVER PERSISTED. `failedClosed` means the
// classifier could not answer, not that the entry is risky. Writing it would do
// two harms at once: permanently withhold an ordinary note, and inflate the
// risk rate — the one number this slice exists to watch. So it retries instead,
// and the note stays unclassified in the meantime, which is already the safe
// state.
import { extractTextFromNoteContent } from './tiptap-text.ts';
import { prefilterHits } from './crisis-terms.ts';
import type { CrisisVerdict } from './crisis-classifier.ts';
import type { Job, NoteRow } from './process-job.ts';
import type { SafetyClass } from './note-safety.ts';

export const NOTE_SAFETY_JOB_KIND = 'note_safety';

export interface SafetyUpsert {
  noteId: string;
  userId: string;
  safetyClass: SafetyClass;
  classifierVersion: string;
  prefilterHit: boolean;
}

export interface SafetyJobOps {
  loadNote(noteId: string): Promise<NoteRow | null>;
  upsertSafety(row: SafetyUpsert): Promise<void>;
  markDone(jobId: string): Promise<void>;
  markFailedOrRetry(job: Job, err: unknown, maxAttempts: number): Promise<void>;
}

const MAX_ATTEMPTS = 3;

export async function processSafetyJob(
  job: Job,
  ops: SafetyJobOps,
  classify: (text: string) => Promise<CrisisVerdict>,
): Promise<void> {
  const noteId = job.payload.note_id;
  if (!noteId) {
    await ops.markFailedOrRetry(job, new Error('invalid payload: no note_id'), MAX_ATTEMPTS);
    return;
  }

  // A deleted note is done, not failed — retrying it forever would fill the
  // queue with work that can never succeed.
  const note = await ops.loadNote(noteId);
  if (!note) {
    await ops.markDone(job.id);
    return;
  }

  const plaintext = extractTextFromNoteContent(note.content);
  const hit = prefilterHits(plaintext);

  try {
    // Nothing written cannot be anything, and the classifier agrees — but
    // short-circuiting here saves the call on every empty note in the vault.
    // The row is still written, because no row means withheld.
    if (!plaintext.trim()) {
      await ops.upsertSafety({
        noteId, userId: note.user_id,
        safetyClass: 'ok', classifierVersion: 'empty', prefilterHit: false,
      });
      await ops.markDone(job.id);
      return;
    }

    const verdict = await classify(plaintext);

    if (verdict.failedClosed) {
      // Not a verdict. Retry rather than persist — see the header.
      await ops.markFailedOrRetry(job, new Error(`classifier unavailable: ${verdict.reason}`), MAX_ATTEMPTS);
      return;
    }

    await ops.upsertSafety({
      noteId,
      userId: note.user_id,
      safetyClass: verdict.safety_class,
      classifierVersion: verdict.classifier_version,
      prefilterHit: hit,
    });
    await ops.markDone(job.id);
  } catch (err) {
    // A failed write leaves the note unclassified, which the gate already
    // treats as withheld. Safe to retry.
    await ops.markFailedOrRetry(job, err, MAX_ATTEMPTS);
  }
}
