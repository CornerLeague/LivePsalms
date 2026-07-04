// Supabase table + storage client for voice recordings. Mirrors
// src/notepad/scan/transcription-client.ts: plain module functions, nullable
// supabase guarded in every function. Signed-in-only feature (spec decision #6).
import { supabase } from '@/lib/supabase';

const BUCKET = 'note-recordings';
export const MAX_RECORDING_SECONDS = 30 * 60;

export interface NoteRecording {
  id: string;
  noteId: string;
  title: string;
  durationSeconds: number;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export type PutFn = (
  url: string,
  blob: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
) => Promise<void>;

export function extensionForMime(mimeType: string): 'webm' | 'mp4' {
  return mimeType.startsWith('audio/webm') ? 'webm' : 'mp4';
}

/** Object key inside the bucket. userId first — storage policies key on foldername[1]. */
export function recordingObjectKey(
  userId: string,
  noteId: string,
  recordingId: string,
  ext: 'webm' | 'mp4',
): string {
  return `${userId}/${noteId}/${recordingId}.${ext}`;
}

/** PUT the blob to a signed upload URL via XHR so we get real progress events. */
export function putWithProgress(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('upload failed: network error'));
    xhr.send(blob);
  });
}

interface RecordingRow {
  id: string;
  note_id: string;
  title: string;
  duration_seconds: number;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

function mapRow(row: RecordingRow): NoteRecording {
  return {
    id: row.id,
    noteId: row.note_id,
    title: row.title,
    durationSeconds: row.duration_seconds,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

/** Upload the finished blob, then insert the DB row. On insert failure the
 *  uploaded object is best-effort removed before rethrowing (spec §2). */
export async function uploadRecording(
  input: {
    userId: string;
    noteId: string;
    recordingId: string;
    blob: Blob;
    mimeType: string;
    durationSeconds: number;
    title?: string;
  },
  onProgress?: (fraction: number) => void,
  put: PutFn = putWithProgress,
): Promise<NoteRecording> {
  if (!supabase) throw new Error('supabase not configured');
  const path = recordingObjectKey(
    input.userId,
    input.noteId,
    input.recordingId,
    extensionForMime(input.mimeType),
  );
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? 'could not create upload URL');
  await put(data.signedUrl, input.blob, input.mimeType, onProgress);

  const { data: row, error: dbErr } = await supabase
    .from('note_recordings')
    .insert({
      id: input.recordingId,
      user_id: input.userId,
      note_id: input.noteId,
      title: input.title ?? '',
      duration_seconds: input.durationSeconds,
      storage_path: path,
      mime_type: input.mimeType,
      size_bytes: input.blob.size,
    })
    .select()
    .single();
  if (dbErr || !row) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
    throw new Error(dbErr?.message ?? 'insert failed');
  }
  return mapRow(row as RecordingRow);
}

export async function listRecordings(noteId: string): Promise<NoteRecording[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('note_recordings')
    .select('*')
    .eq('note_id', noteId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RecordingRow[]).map(mapRow);
}

/** Signed playback URL (1-hour default, spec §3). */
export async function signedRecordingUrl(
  storagePath: string,
  expiresInSec = 3600,
): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSec);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function renameRecording(id: string, title: string): Promise<void> {
  if (!supabase) throw new Error('supabase not configured');
  const { error } = await supabase.from('note_recordings').update({ title }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Storage object first, then row — mirrors discardScan's order. */
export async function deleteRecording(
  rec: Pick<NoteRecording, 'id' | 'storagePath'>,
): Promise<void> {
  if (!supabase) throw new Error('supabase not configured');
  const { error: storageErr } = await supabase.storage.from(BUCKET).remove([rec.storagePath]);
  if (storageErr) throw new Error(`audio delete failed: ${storageErr.message}`);
  const { error: dbErr } = await supabase.from('note_recordings').delete().eq('id', rec.id);
  if (dbErr) throw new Error(`row delete failed: ${dbErr.message}`);
}

/** Best-effort storage cleanup after a note is deleted (DB rows cascade).
 *  NEVER throws — an orphaned object in a private bucket is invisible and
 *  cheap; a note that refuses to delete is bad UX (spec §1). */
export async function removeRecordingsForNote(userId: string, noteId: string): Promise<void> {
  if (!supabase) return;
  try {
    const folder = `${userId}/${noteId}`;
    const { data, error } = await supabase.storage.from(BUCKET).list(folder);
    if (error) {
      console.warn('[recordings] cleanup list failed', error.message);
      return;
    }
    if (!data?.length) return;
    const paths = data.map((f) => `${folder}/${f.name}`);
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
    if (rmErr) console.warn('[recordings] cleanup remove failed', rmErr.message);
  } catch (err) {
    console.warn('[recordings] cleanup failed', err);
  }
}
