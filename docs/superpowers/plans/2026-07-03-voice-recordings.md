# Voice Recordings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in users record voice notes attached to a journal note (chips strip under the title), played back in a global docked mini-player; audio in a private Supabase bucket with an RLS'd `note_recordings` table.

**Architecture:** Satellite data, mirroring the handwriting-scan feature: migration modeled on `019_note_transcriptions.sql`, a plain-function client module modeled on `transcription-client.ts`, one workspace-level `RecordingsAudioProvider` owning both the MediaRecorder session and the single `Audio()` playback instance (pure reducer exported for tests), and two view components (`RecordingsStrip`, `RecordingsDock`). Deliberately bypasses `StorageAdapter` (spec decision #6) — no stubs in `local-storage.ts`.

**Tech Stack:** Vite 7 + React 19, TypeScript, Supabase (`@supabase/supabase-js ^2.105.3`), MediaRecorder API, sonner toasts, `uuid ^14`, vitest + testing-library.

**Spec:** `docs/superpowers/specs/2026-07-03-voice-recordings-design.md` (approved 2026-07-03).

## Deviations & layout decisions (surfaced for the user)

1. **Mobile dock stacks above `MobileTabBar`, not `MobileBottomDock`** — user-approved. `MobileBottomDock` is not mounted on workspace routes (`src/App.tsx:191`); the workspace bottom bar is `MobileTabBar`.
2. **Note-delete cleanup lives in `SupabaseStorageAdapter.deleteNote`, not `notepad-actions`** — user-approved. `NotepadActions.deleteNote` is adapter-agnostic and has no `userId`; the adapter is the signed-in delete path.
3. **Dock is a flex footer, not CSS `position: fixed`.** Both workspaces are flex columns (`MobileNotepadWorkspace` root, desktop `<main>` in `Notepad.tsx:174`), so the dock renders as a `shrink-0` last flex child: it naturally sits above `MobileTabBar` on mobile and at the bottom of the workspace column on desktop, and content auto-shrinks — the spec's "workspace gets bottom padding while visible" falls out for free with no offset math. Consequence: on desktop, when the graph is expanded the `<main>` column collapses and the dock is hidden with it (audio keeps playing) — accepted.
4. **Speed control is a cycle button** (1× → 1.25× → 1.5× → 2× → 0.75× → …) instead of a dropdown menu — all five spec values reachable in one tap, and it avoids radix-menu pointer-event flakiness in jsdom tests. The chip kebab menu is always visible (not hover-revealed on desktop) — hover-only affordances are untestable in jsdom and worse for touch.
5. **Signed-out nudge is a muted non-interactive line** (mic icon + "Sign in to record voice notes"), following the repo precedent (`LamplightMobileView`'s plain "Sign in to see connections." line). No shared open-auth mechanism is reachable from `Editor.tsx` without new prop plumbing through both workspaces — YAGNI for v1.

## Global Constraints

- **Branch:** commit to `feat/notepad-hero-copy-polish`. The tree has unrelated in-flight work — `git add` ONLY files this plan names. Never `git add -A` / `git add .`. Never switch branches or stash.
- **Gate per task:** `npx eslint <touched files>` clean (118 pre-existing errors elsewhere are out of scope) and `npx vitest run` green (baseline 2700 passed | 38 skipped).
- **Tests:** vitest default environment is **node** — every DOM/component test file starts with `// @vitest-environment jsdom` as its FIRST line. Colocated `*.test.ts(x)`. `src/test-setup.ts` already stubs `HTMLMediaElement.prototype.play/pause`.
- **Signed-in only** feature; do NOT touch `src/notepad/storage/local-storage.ts` or the `StorageAdapter` interface.
- **Bucket** `note-recordings`; object path `{userId}/{noteId}/{recordingId}.{ext}` (userId first — storage policies key on `(storage.foldername(name))[1]`). No bucket prefix in `storage_path` (unlike scans).
- **Cap:** `MAX_RECORDING_SECONDS = 1800` (30 min) — auto-stop **saves**, never discards.
- **Styling idiom:** CSS vars (`var(--deep-umber)`, `var(--silica)`, `var(--pale-stone)`, `var(--notepad-bar-bg)`), `fontFamily: 'Outfit, sans-serif'`, tiny sizes (`text-[11px]`).
- New source files live in `src/notepad/recordings/`. Imports use the `@/` alias (e.g. `@/lib/supabase`); `supabase` is `SupabaseClient | null` — guard every function.
- Never read `.env.local`.

---

### Task 1: Migration `043_note_recordings.sql`

**Files:**
- Create: `supabase/migrations/043_note_recordings.sql`

**Interfaces:**
- Produces: table `note_recordings` (columns exactly as below) and private bucket `note-recordings` that Task 2's client reads/writes.

- [ ] **Step 1: Write the migration** (modeled on `supabase/migrations/019_note_transcriptions.sql`; table DDL verbatim from spec §1)

```sql
-- 043_note_recordings.sql
-- Voice recordings attached to notes + private audio bucket.

create table if not exists note_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  note_id uuid not null references notes(id) on delete cascade,
  title text not null default '',        -- UI falls back to date label when empty
  duration_seconds integer not null,
  storage_path text not null,            -- {user_id}/{note_id}/{recording_id}.webm|.mp4
  mime_type text not null,               -- 'audio/webm' | 'audio/mp4'
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists note_recordings_user_idx on note_recordings(user_id);
create index if not exists note_recordings_note_idx on note_recordings(note_id);

alter table note_recordings enable row level security;

create policy "Users can view own recordings"
  on note_recordings for select using (auth.uid() = user_id);
create policy "Users can create own recordings"
  on note_recordings for insert with check (auth.uid() = user_id);
create policy "Users can update own recordings"
  on note_recordings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Users can delete own recordings"
  on note_recordings for delete using (auth.uid() = user_id);

-- Private bucket for voice recordings (sensitive personal journal content).
insert into storage.buckets (id, name, public)
values ('note-recordings', 'note-recordings', false)
on conflict (id) do nothing;

create policy "Users can upload own recordings"
  on storage.objects for insert
  with check (
    bucket_id = 'note-recordings' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "Users can read own recordings"
  on storage.objects for select
  using (
    bucket_id = 'note-recordings' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "Users can update own recordings"
  on storage.objects for update
  using (
    bucket_id = 'note-recordings' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "Users can delete own recordings"
  on storage.objects for delete
  using (
    bucket_id = 'note-recordings' and (storage.foldername(name))[1] = auth.uid()::text
  );

create trigger note_recordings_updated_at
  before update on public.note_recordings
  for each row execute function public.update_updated_at();
```

- [ ] **Step 2: Review against 019** — same structure: table + 2 indexes + RLS enable + 4 owner policies + bucket insert + 4 storage policies + `update_updated_at` trigger. Differences are intentional: `note_id … on delete cascade` (scans use `set null`) and `note_id` is `not null`.

- [ ] **Step 3: Commit** (do NOT apply the migration now — it's applied in Task 8 with the user in the loop)

```bash
git add supabase/migrations/043_note_recordings.sql
git commit -m "feat(recordings): add note_recordings table + private bucket migration"
```

---

### Task 2: `recordings-client.ts`

**Files:**
- Create: `src/notepad/recordings/recordings-client.ts`
- Test: `src/notepad/recordings/recordings-client.test.ts`

**Interfaces:**
- Consumes: table/bucket from Task 1; `supabase` from `@/lib/supabase` (nullable).
- Produces (used by Tasks 3, 5, 7):
  - `interface NoteRecording { id: string; noteId: string; title: string; durationSeconds: number; storagePath: string; mimeType: string; sizeBytes: number; createdAt: string }`
  - `MAX_RECORDING_SECONDS: number` (1800)
  - `recordingObjectKey(userId: string, noteId: string, recordingId: string, ext: 'webm' | 'mp4'): string`
  - `extensionForMime(mimeType: string): 'webm' | 'mp4'`
  - `type PutFn = (url: string, blob: Blob, contentType: string, onProgress?: (fraction: number) => void) => Promise<void>`
  - `uploadRecording(input: { userId: string; noteId: string; recordingId: string; blob: Blob; mimeType: string; durationSeconds: number; title?: string }, onProgress?: (fraction: number) => void, put?: PutFn): Promise<NoteRecording>`
  - `listRecordings(noteId: string): Promise<NoteRecording[]>`
  - `signedRecordingUrl(storagePath: string, expiresInSec?: number): Promise<string | null>`
  - `renameRecording(id: string, title: string): Promise<void>`
  - `deleteRecording(rec: Pick<NoteRecording, 'id' | 'storagePath'>): Promise<void>`
  - `removeRecordingsForNote(userId: string, noteId: string): Promise<void>` (never throws)

- [ ] **Step 1: Write the failing tests**

```ts
// src/notepad/recordings/recordings-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockSupabase: unknown = null;
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mockSupabase;
  },
}));

import {
  recordingObjectKey,
  extensionForMime,
  uploadRecording,
  listRecordings,
  signedRecordingUrl,
  deleteRecording,
  renameRecording,
  removeRecordingsForNote,
} from './recordings-client';

/** Chainable supabase query mock: every method returns itself; awaiting resolves `result`. */
function chain(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['insert', 'select', 'update', 'delete', 'eq', 'order', 'single']) {
    q[m] = vi.fn(() => q);
  }
  (q as { then: unknown }).then = (res: (v: unknown) => void) => Promise.resolve(result).then(res);
  return q as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>;
}

const dbRow = {
  id: 'rec-1',
  note_id: 'note-1',
  title: '',
  duration_seconds: 12,
  storage_path: 'user-1/note-1/rec-1.webm',
  mime_type: 'audio/webm',
  size_bytes: 3456,
  created_at: '2026-07-03T00:00:00Z',
};

function makeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const storageApi = {
    createSignedUploadUrl: vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/put', token: 't', path: 'p' },
      error: null,
    })),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://signed.example/get' }, error: null })),
    remove: vi.fn(async () => ({ data: null, error: null })),
    list: vi.fn(async () => ({ data: [{ name: 'rec-1.webm' }, { name: 'rec-2.mp4' }], error: null })),
    ...overrides,
  };
  return {
    storage: { from: vi.fn(() => storageApi) },
    from: vi.fn(() => chain({ data: dbRow, error: null })),
    _storageApi: storageApi,
  };
}

beforeEach(() => {
  mockSupabase = null;
  vi.clearAllMocks();
});

describe('recordingObjectKey / extensionForMime', () => {
  it('builds {userId}/{noteId}/{recordingId}.{ext} with no bucket prefix', () => {
    expect(recordingObjectKey('u1', 'n1', 'r1', 'webm')).toBe('u1/n1/r1.webm');
  });
  it('maps mime types to extensions', () => {
    expect(extensionForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForMime('audio/mp4')).toBe('mp4');
  });
});

describe('null-supabase guards', () => {
  it('uploadRecording rejects', async () => {
    await expect(
      uploadRecording(
        { userId: 'u', noteId: 'n', recordingId: 'r', blob: new Blob(), mimeType: 'audio/webm', durationSeconds: 1 },
        undefined,
        vi.fn(),
      ),
    ).rejects.toThrow('supabase not configured');
  });
  it('listRecordings returns []', async () => {
    expect(await listRecordings('n')).toEqual([]);
  });
  it('signedRecordingUrl returns null', async () => {
    expect(await signedRecordingUrl('u/n/r.webm')).toBeNull();
  });
  it('removeRecordingsForNote resolves', async () => {
    await expect(removeRecordingsForNote('u', 'n')).resolves.toBeUndefined();
  });
});

describe('uploadRecording', () => {
  it('happy path: signed URL → put → insert → mapped row', async () => {
    const client = makeClient();
    mockSupabase = client;
    const put = vi.fn(async () => undefined);
    const blob = new Blob(['abc'], { type: 'audio/webm' });
    const rec = await uploadRecording(
      { userId: 'user-1', noteId: 'note-1', recordingId: 'rec-1', blob, mimeType: 'audio/webm', durationSeconds: 12 },
      undefined,
      put,
    );
    expect(client._storageApi.createSignedUploadUrl).toHaveBeenCalledWith('user-1/note-1/rec-1.webm');
    expect(put).toHaveBeenCalledWith('https://signed.example/put', blob, 'audio/webm', undefined);
    expect(rec).toEqual({
      id: 'rec-1',
      noteId: 'note-1',
      title: '',
      durationSeconds: 12,
      storagePath: 'user-1/note-1/rec-1.webm',
      mimeType: 'audio/webm',
      sizeBytes: 3456,
      createdAt: '2026-07-03T00:00:00Z',
    });
  });

  it('signed-URL error propagates', async () => {
    const client = makeClient({
      createSignedUploadUrl: vi.fn(async () => ({ data: null, error: { message: 'nope' } })),
    });
    mockSupabase = client;
    await expect(
      uploadRecording(
        { userId: 'u', noteId: 'n', recordingId: 'r', blob: new Blob(), mimeType: 'audio/webm', durationSeconds: 1 },
        undefined,
        vi.fn(),
      ),
    ).rejects.toThrow('nope');
  });

  it('insert failure removes the uploaded object then rejects', async () => {
    const client = makeClient();
    client.from = vi.fn(() => chain({ data: null, error: { message: 'insert failed' } }));
    mockSupabase = client;
    await expect(
      uploadRecording(
        { userId: 'u', noteId: 'n', recordingId: 'r', blob: new Blob(), mimeType: 'audio/webm', durationSeconds: 1 },
        undefined,
        vi.fn(async () => undefined),
      ),
    ).rejects.toThrow('insert failed');
    expect(client._storageApi.remove).toHaveBeenCalledWith(['u/n/r.webm']);
  });
});

describe('deleteRecording', () => {
  it('removes the storage object before the row', async () => {
    const client = makeClient();
    mockSupabase = client;
    await deleteRecording({ id: 'rec-1', storagePath: 'u/n/rec-1.webm' });
    expect(client._storageApi.remove).toHaveBeenCalledWith(['u/n/rec-1.webm']);
    expect(client._storageApi.remove.mock.invocationCallOrder[0]).toBeLessThan(
      client.from.mock.invocationCallOrder[0],
    );
  });

  it('storage failure rejects and skips the row delete', async () => {
    const client = makeClient({ remove: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) });
    mockSupabase = client;
    await expect(deleteRecording({ id: 'rec-1', storagePath: 'u/n/rec-1.webm' })).rejects.toThrow('boom');
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('renameRecording', () => {
  it('updates the title by id', async () => {
    const client = makeClient();
    const q = chain({ data: null, error: null });
    client.from = vi.fn(() => q);
    mockSupabase = client;
    await renameRecording('rec-1', 'Morning prayer');
    expect(q.update).toHaveBeenCalledWith({ title: 'Morning prayer' });
    expect(q.eq).toHaveBeenCalledWith('id', 'rec-1');
  });
});

describe('removeRecordingsForNote', () => {
  it('lists the note folder and removes every object', async () => {
    const client = makeClient();
    mockSupabase = client;
    await removeRecordingsForNote('user-1', 'note-1');
    expect(client._storageApi.list).toHaveBeenCalledWith('user-1/note-1');
    expect(client._storageApi.remove).toHaveBeenCalledWith([
      'user-1/note-1/rec-1.webm',
      'user-1/note-1/rec-2.mp4',
    ]);
  });

  it('never throws: list error resolves quietly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = makeClient({ list: vi.fn(async () => ({ data: null, error: { message: 'down' } })) });
    mockSupabase = client;
    await expect(removeRecordingsForNote('u', 'n')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/notepad/recordings/recordings-client.test.ts`
Expected: FAIL — cannot resolve `./recordings-client`.

- [ ] **Step 3: Write the implementation**

```ts
// src/notepad/recordings/recordings-client.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/notepad/recordings/recordings-client.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint src/notepad/recordings/recordings-client.ts src/notepad/recordings/recordings-client.test.ts
git add src/notepad/recordings/recordings-client.ts src/notepad/recordings/recordings-client.test.ts
git commit -m "feat(recordings): supabase client for note voice recordings"
```

---

### Task 3: `audio-context.tsx` — reducer + `RecordingsAudioProvider`

**Files:**
- Create: `src/notepad/recordings/audio-context.tsx`
- Create: `src/notepad/recordings/fakes.ts` (test doubles for MediaRecorder/Audio — imported only by tests)
- Test: `src/notepad/recordings/audio-context.test.tsx`

**Interfaces:**
- Consumes: from Task 2 — `NoteRecording`, `MAX_RECORDING_SECONDS`, `uploadRecording`, `signedRecordingUrl`; `useAuthSession()` from `@/auth/context/useAuthSession` (`{ user }`, id `user.id`); `toast` from `sonner`.
- Produces (used by Tasks 4, 5, 6):
  - `type AudioMode = 'idle' | 'recording' | 'playing' | 'paused'`
  - `type RecorderStatus = 'recording' | 'rec-paused' | 'uploading' | 'failed'`
  - `interface RecorderSession { noteId: string; status: RecorderStatus; elapsedSec: number; uploadProgress: number; error: string | null; mimeType: string }`
  - `interface PlaybackTrack { recordingId: string; noteId: string; label: string; durationSeconds: number; storagePath: string }`
  - `interface AudioState { mode: AudioMode; recorder: RecorderSession | null; track: PlaybackTrack | null; positionSec: number; speed: number; savedVersion: number }`
  - `initialAudioState: AudioState`, `audioReducer(state: AudioState, action: AudioAction): AudioState` (pure, exported for tests — tree-view-state.tsx precedent)
  - `RecordingsAudioProvider({ children })`
  - `useRecordingsAudio(): RecordingsAudioValue` — throws outside provider (bible-prefs-context.ts precedent). Value:
    - state fields above, plus:
    - `startRecording(noteId: string): Promise<'ok' | 'permission-denied' | 'busy'>`
    - `pauseRecording(): void`, `resumeRecording(): void`, `stopRecording(): void`, `cancelRecording(): void`
    - `retryUpload(): void`, `discardRecording(): void`
    - `playRecording(rec: NoteRecording): Promise<void>`, `togglePlayback(): void`
    - `seekTo(sec: number): void`, `skipBy(deltaSec: number): void`, `setSpeed(speed: number): void`
    - `closeDock(): void`, `stopIfCurrent(recordingId: string): void`
  - `recordingLabel(rec: Pick<NoteRecording, 'title' | 'createdAt'>): string` — title, or date fallback "Jul 3, 2026"

- [ ] **Step 1: Write the test doubles**

```ts
// src/notepad/recordings/fakes.ts
// Test doubles for browser media APIs (absent/limited in jsdom).
// Imported only by *.test.tsx files — never by shipped code.
import { vi } from 'vitest';

export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn((type: string) => type.startsWith('audio/webm'));
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  stream: MediaStream;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }
  start = vi.fn(() => { this.state = 'recording'; });
  pause = vi.fn(() => { this.state = 'paused'; });
  resume = vi.fn(() => { this.state = 'recording'; });
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) });
    this.onstop?.();
  });
}

export class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  #listeners = new Map<string, Set<() => void>>();
  constructor() {
    FakeAudio.instances.push(this);
  }
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  addEventListener(type: string, fn: () => void) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.#listeners.get(type)?.delete(fn);
  }
  emit(type: string) {
    this.#listeners.get(type)?.forEach((fn) => fn());
  }
}

/** Install fakes on window/navigator; returns a restore function. */
export function installMediaFakes() {
  FakeMediaRecorder.instances = [];
  FakeAudio.instances = [];
  const fakeStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => fakeStream);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('Audio', FakeAudio);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  return { getUserMedia, restore: () => vi.unstubAllGlobals() };
}
```

- [ ] **Step 2: Write the failing tests**

```tsx
// @vitest-environment jsdom
// src/notepad/recordings/audio-context.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  audioReducer,
  initialAudioState,
  recordingLabel,
  RecordingsAudioProvider,
  useRecordingsAudio,
  type AudioState,
  type RecordingsAudioValue,
} from './audio-context';
import { installMediaFakes, FakeAudio, FakeMediaRecorder } from './fakes';
import type { NoteRecording } from './recordings-client';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'user-1' }, adapter: null, session: null }),
}));
const client = vi.hoisted(() => ({
  uploadRecording: vi.fn(),
  signedRecordingUrl: vi.fn(),
}));
vi.mock('./recordings-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recordings-client')>()),
  uploadRecording: client.uploadRecording,
  signedRecordingUrl: client.signedRecordingUrl,
}));
import { toast } from 'sonner';

const rec: NoteRecording = {
  id: 'rec-1', noteId: 'note-1', title: '', durationSeconds: 60,
  storagePath: 'user-1/note-1/rec-1.webm', mimeType: 'audio/webm',
  sizeBytes: 100, createdAt: '2026-07-03T12:00:00Z',
};
const track = {
  recordingId: 'rec-1', noteId: 'note-1', label: 'Jul 3, 2026',
  durationSeconds: 60, storagePath: 'user-1/note-1/rec-1.webm',
};

describe('audioReducer (pure)', () => {
  const recordingState: AudioState = audioReducer(initialAudioState, {
    type: 'RECORD_START', noteId: 'note-1', mimeType: 'audio/webm',
  });

  it('RECORD_START enters recording mode and clears playback', () => {
    const playing = audioReducer(initialAudioState, { type: 'PLAY_TRACK', track });
    const next = audioReducer(playing, { type: 'RECORD_START', noteId: 'n2', mimeType: 'audio/webm' });
    expect(next.mode).toBe('recording');
    expect(next.track).toBeNull();
  });

  it('RECORD_START is ignored while a recorder session exists', () => {
    const next = audioReducer(recordingState, { type: 'RECORD_START', noteId: 'other', mimeType: 'audio/mp4' });
    expect(next.recorder?.noteId).toBe('note-1');
  });

  it('PLAY_TRACK is ignored while recording (exclusivity)', () => {
    const next = audioReducer(recordingState, { type: 'PLAY_TRACK', track });
    expect(next.track).toBeNull();
    expect(next.mode).toBe('recording');
  });

  it('RECORD_TICK accumulates only while status is recording', () => {
    let s = audioReducer(recordingState, { type: 'RECORD_TICK', seconds: 5 });
    expect(s.recorder?.elapsedSec).toBe(5);
    s = audioReducer(s, { type: 'RECORD_PAUSE' });
    s = audioReducer(s, { type: 'RECORD_TICK', seconds: 10 });
    expect(s.recorder?.elapsedSec).toBe(5);
    s = audioReducer(s, { type: 'RECORD_RESUME' });
    s = audioReducer(s, { type: 'RECORD_TICK', seconds: 3 });
    expect(s.recorder?.elapsedSec).toBe(8);
  });

  it('RECORD_STOP moves to uploading and mode idle; UPLOAD_DONE clears and bumps savedVersion', () => {
    let s = audioReducer(recordingState, { type: 'RECORD_STOP' });
    expect(s.mode).toBe('idle');
    expect(s.recorder?.status).toBe('uploading');
    s = audioReducer(s, { type: 'UPLOAD_DONE' });
    expect(s.recorder).toBeNull();
    expect(s.savedVersion).toBe(1);
  });

  it('CLOSE resets playback to idle', () => {
    const playing = audioReducer(initialAudioState, { type: 'PLAY_TRACK', track });
    const next = audioReducer(playing, { type: 'CLOSE' });
    expect(next).toMatchObject({ mode: 'idle', track: null, positionSec: 0 });
  });
});

describe('recordingLabel', () => {
  it('prefers the title, falls back to a date label', () => {
    expect(recordingLabel({ title: 'Psalm 23', createdAt: rec.createdAt })).toBe('Psalm 23');
    expect(recordingLabel({ title: '', createdAt: rec.createdAt })).toBe('Jul 3, 2026');
  });
});

describe('RecordingsAudioProvider', () => {
  let ctx: RecordingsAudioValue;
  function Capture() {
    ctx = useRecordingsAudio();
    return null;
  }
  let fakes: ReturnType<typeof installMediaFakes>;

  beforeEach(() => {
    vi.useFakeTimers();
    fakes = installMediaFakes();
    client.uploadRecording.mockResolvedValue(rec);
    client.signedRecordingUrl.mockResolvedValue('https://signed.example/a.webm');
  });
  afterEach(() => {
    fakes.restore();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function mount() {
    render(
      <RecordingsAudioProvider>
        <Capture />
      </RecordingsAudioProvider>,
    );
  }

  it('useRecordingsAudio throws outside the provider', () => {
    function Bare() { useRecordingsAudio(); return null; }
    expect(() => render(<Bare />)).toThrow();
  });

  it('records, then auto-stops and saves at the 30-minute cap', async () => {
    mount();
    await act(async () => {
      expect(await ctx.startRecording('note-1')).toBe('ok');
    });
    expect(ctx.mode).toBe('recording');
    await act(async () => {
      vi.advanceTimersByTime(1800_000);
      await Promise.resolve();
    });
    expect(FakeMediaRecorder.instances[0].stop).toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
    expect(client.uploadRecording).toHaveBeenCalled();
  });

  it('excludes paused time from elapsed duration', async () => {
    mount();
    await act(async () => { await ctx.startRecording('note-1'); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    act(() => ctx.pauseRecording());
    await act(async () => { vi.advanceTimersByTime(10_000); });
    act(() => ctx.resumeRecording());
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(ctx.recorder?.elapsedSec).toBe(8);
    await act(async () => {
      ctx.stopRecording();
      await Promise.resolve();
    });
    expect(client.uploadRecording).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 8 }),
      expect.any(Function),
    );
  });

  it('failed upload keeps a retryable session', async () => {
    client.uploadRecording.mockRejectedValueOnce(new Error('offline'));
    mount();
    await act(async () => { await ctx.startRecording('note-1'); });
    await act(async () => {
      ctx.stopRecording();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctx.recorder?.status).toBe('failed');
    await act(async () => {
      ctx.retryUpload();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctx.recorder).toBeNull();
    expect(ctx.savedVersion).toBe(1);
  });

  it('plays a recording and retries an expired URL exactly once', async () => {
    mount();
    await act(async () => { await ctx.playRecording(rec); });
    const audio = FakeAudio.instances[0];
    expect(audio.src).toBe('https://signed.example/a.webm');
    expect(ctx.mode).toBe('playing');

    audio.currentTime = 30;
    act(() => audio.emit('timeupdate'));
    client.signedRecordingUrl.mockResolvedValue('https://signed.example/fresh.webm');
    await act(async () => {
      audio.emit('error');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(audio.src).toBe('https://signed.example/fresh.webm');
    expect(audio.currentTime).toBe(30);
    expect(client.signedRecordingUrl).toHaveBeenCalledTimes(2);

    await act(async () => {
      audio.emit('error');
      await Promise.resolve();
    });
    expect(client.signedRecordingUrl).toHaveBeenCalledTimes(2); // no third fetch
  });

  it('stopIfCurrent closes the dock only for the matching recording', async () => {
    mount();
    await act(async () => { await ctx.playRecording(rec); });
    act(() => ctx.stopIfCurrent('other-id'));
    expect(ctx.mode).toBe('playing');
    act(() => ctx.stopIfCurrent('rec-1'));
    expect(ctx.mode).toBe('idle');
    expect(ctx.track).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/notepad/recordings/audio-context.test.tsx`
Expected: FAIL — cannot resolve `./audio-context`.

- [ ] **Step 4: Write the implementation**

```tsx
// src/notepad/recordings/audio-context.tsx
// Global audio state for voice recordings: one provider owns BOTH the
// MediaRecorder session and the single Audio() playback instance, so
// record/play exclusivity is structural (spec §3). Pure reducer exported for
// tests (tree-view-state.tsx precedent); hook throws outside the provider
// (bible-prefs-context.ts precedent).
import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef,
  type ReactNode,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { useAuthSession } from '@/auth/context/useAuthSession';
import {
  MAX_RECORDING_SECONDS, extensionForMime, signedRecordingUrl, uploadRecording,
  type NoteRecording,
} from './recordings-client';

export type AudioMode = 'idle' | 'recording' | 'playing' | 'paused';
export type RecorderStatus = 'recording' | 'rec-paused' | 'uploading' | 'failed';

export interface RecorderSession {
  noteId: string;
  status: RecorderStatus;
  elapsedSec: number;
  uploadProgress: number; // 0..1
  error: string | null;
  mimeType: string;
}

export interface PlaybackTrack {
  recordingId: string;
  noteId: string;
  label: string;
  durationSeconds: number;
  storagePath: string;
}

export interface AudioState {
  mode: AudioMode;
  recorder: RecorderSession | null;
  track: PlaybackTrack | null;
  positionSec: number;
  speed: number;
  savedVersion: number; // bumped on successful upload → strips refetch
}

export type AudioAction =
  | { type: 'RECORD_START'; noteId: string; mimeType: string }
  | { type: 'RECORD_TICK'; seconds: number }
  | { type: 'RECORD_PAUSE' }
  | { type: 'RECORD_RESUME' }
  | { type: 'RECORD_STOP' }
  | { type: 'UPLOAD_PROGRESS'; progress: number }
  | { type: 'UPLOAD_DONE' }
  | { type: 'UPLOAD_FAILED'; error: string }
  | { type: 'RECORDER_CLEAR' }
  | { type: 'PLAY_TRACK'; track: PlaybackTrack }
  | { type: 'PLAYBACK_PLAYING' }
  | { type: 'PLAYBACK_PAUSED' }
  | { type: 'POSITION'; seconds: number }
  | { type: 'SPEED'; speed: number }
  | { type: 'CLOSE' };

export const initialAudioState: AudioState = {
  mode: 'idle', recorder: null, track: null, positionSec: 0, speed: 1, savedVersion: 0,
};

export function audioReducer(state: AudioState, action: AudioAction): AudioState {
  switch (action.type) {
    case 'RECORD_START':
      // One recorder slot: a pending (uploading/failed) session must be
      // resolved via Retry/Discard before a new capture starts.
      if (state.recorder) return state;
      return {
        ...state,
        mode: 'recording',
        track: null,
        positionSec: 0,
        recorder: {
          noteId: action.noteId, status: 'recording', elapsedSec: 0,
          uploadProgress: 0, error: null, mimeType: action.mimeType,
        },
      };
    case 'RECORD_TICK':
      if (state.recorder?.status !== 'recording') return state;
      return {
        ...state,
        recorder: { ...state.recorder, elapsedSec: state.recorder.elapsedSec + action.seconds },
      };
    case 'RECORD_PAUSE':
      if (state.recorder?.status !== 'recording') return state;
      return { ...state, recorder: { ...state.recorder, status: 'rec-paused' } };
    case 'RECORD_RESUME':
      if (state.recorder?.status !== 'rec-paused') return state;
      return { ...state, recorder: { ...state.recorder, status: 'recording' } };
    case 'RECORD_STOP':
      if (!state.recorder) return state;
      return {
        ...state,
        mode: 'idle',
        recorder: { ...state.recorder, status: 'uploading', uploadProgress: 0 },
      };
    case 'UPLOAD_PROGRESS':
      if (state.recorder?.status !== 'uploading') return state;
      return { ...state, recorder: { ...state.recorder, uploadProgress: action.progress } };
    case 'UPLOAD_DONE':
      return { ...state, recorder: null, savedVersion: state.savedVersion + 1 };
    case 'UPLOAD_FAILED':
      if (!state.recorder) return state;
      return { ...state, recorder: { ...state.recorder, status: 'failed', error: action.error } };
    case 'RECORDER_CLEAR':
      return { ...state, recorder: null, mode: state.mode === 'recording' ? 'idle' : state.mode };
    case 'PLAY_TRACK':
      if (state.mode === 'recording') return state; // chips are inert while recording
      return { ...state, mode: 'playing', track: action.track, positionSec: 0 };
    case 'PLAYBACK_PLAYING':
      if (!state.track) return state;
      return { ...state, mode: 'playing' };
    case 'PLAYBACK_PAUSED':
      if (!state.track) return state;
      return { ...state, mode: 'paused' };
    case 'POSITION':
      return { ...state, positionSec: action.seconds };
    case 'SPEED':
      return { ...state, speed: action.speed };
    case 'CLOSE':
      return { ...state, mode: 'idle', track: null, positionSec: 0 };
    default:
      return state;
  }
}

/** Chip/dock display label: title, or a date like "Jul 3, 2026" (spec §4). */
export function recordingLabel(rec: Pick<NoteRecording, 'title' | 'createdAt'>): string {
  if (rec.title.trim()) return rec.title;
  return new Date(rec.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export interface RecordingsAudioValue extends AudioState {
  startRecording(noteId: string): Promise<'ok' | 'permission-denied' | 'busy'>;
  pauseRecording(): void;
  resumeRecording(): void;
  stopRecording(): void;
  cancelRecording(): void;
  retryUpload(): void;
  discardRecording(): void;
  playRecording(rec: NoteRecording): Promise<void>;
  togglePlayback(): void;
  seekTo(sec: number): void;
  skipBy(deltaSec: number): void;
  setSpeed(speed: number): void;
  closeDock(): void;
  stopIfCurrent(recordingId: string): void;
}

const RecordingsAudioContext = createContext<RecordingsAudioValue | null>(null);

export function useRecordingsAudio(): RecordingsAudioValue {
  const ctx = useContext(RecordingsAudioContext);
  if (!ctx) throw new Error('useRecordingsAudio must be used within RecordingsAudioProvider');
  return ctx;
}

export function RecordingsAudioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthSession();
  const [state, dispatch] = useReducer(audioReducer, initialAudioState);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  // Pending upload payload — survives navigation for Retry (spec §2).
  const pendingRef = useRef<{
    userId: string; noteId: string; recordingId: string; blob: Blob;
    mimeType: string; durationSeconds: number;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRetriedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const clearTick = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  };

  const runUpload = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    uploadRecording(pending, (fraction) =>
      dispatch({ type: 'UPLOAD_PROGRESS', progress: fraction }),
    )
      .then(() => {
        pendingRef.current = null;
        dispatch({ type: 'UPLOAD_DONE' });
      })
      .catch((err: unknown) => {
        dispatch({ type: 'UPLOAD_FAILED', error: err instanceof Error ? err.message : 'upload failed' });
        toast.error('Recording upload failed — retry from the note.');
      });
  }, []);

  const teardownCapture = () => {
    clearTick();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  };

  const startRecording = useCallback(
    async (noteId: string): Promise<'ok' | 'permission-denied' | 'busy'> => {
      if (!user || stateRef.current.recorder) return 'busy';
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        return 'permission-denied';
      }
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4'; // Safari
      const container = mimeType.startsWith('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const wasCancelled = cancelledRef.current;
        const elapsed = stateRef.current.recorder?.elapsedSec ?? 0;
        teardownCapture();
        if (wasCancelled) {
          chunksRef.current = [];
          dispatch({ type: 'RECORDER_CLEAR' });
          return;
        }
        const blob = new Blob(chunksRef.current, { type: container });
        chunksRef.current = [];
        pendingRef.current = {
          userId: user.id, noteId, recordingId: uuidv4(), blob,
          mimeType: container, durationSeconds: elapsed,
        };
        dispatch({ type: 'RECORD_STOP' });
        runUpload();
      };
      // Mic unplugged etc: salvage the chunks collected so far (spec §2) —
      // onstop fires next and routes them into the normal upload path.
      recorder.onerror = () => {
        toast.error('Recording interrupted — saving what was captured.');
        if (recorder.state !== 'inactive') recorder.stop();
      };

      recorder.start(1000); // timeslice: chunks accumulate in memory
      dispatch({ type: 'RECORD_START', noteId, mimeType: container });
      tickRef.current = setInterval(() => dispatch({ type: 'RECORD_TICK', seconds: 1 }), 1000);
      return 'ok';
    },
    [user, runUpload],
  );

  const pauseRecording = useCallback(() => {
    const r = mediaRecorderRef.current;
    if (r?.state === 'recording') {
      r.pause();
      dispatch({ type: 'RECORD_PAUSE' });
    }
  }, []);

  const resumeRecording = useCallback(() => {
    const r = mediaRecorderRef.current;
    if (r?.state === 'paused') {
      r.resume();
      dispatch({ type: 'RECORD_RESUME' });
    }
  }, []);

  const stopRecording = useCallback(() => {
    const r = mediaRecorderRef.current;
    if (r && r.state !== 'inactive') r.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    const r = mediaRecorderRef.current;
    if (r && r.state !== 'inactive') r.stop();
  }, []);

  const retryUpload = useCallback(() => {
    if (stateRef.current.recorder?.status !== 'failed') return;
    dispatch({ type: 'RECORD_STOP' }); // back to uploading
    runUpload();
  }, [runUpload]);

  const discardRecording = useCallback(() => {
    pendingRef.current = null;
    dispatch({ type: 'RECORDER_CLEAR' });
  }, []);

  // 30-minute cap: auto-stop SAVES, never discards (spec §2).
  useEffect(() => {
    if (state.recorder?.status === 'recording' && state.recorder.elapsedSec >= MAX_RECORDING_SECONDS) {
      toast('Recording reached the 30-minute limit and was saved.');
      stopRecording();
    }
  }, [state.recorder?.status, state.recorder?.elapsedSec, stopRecording]);

  // ── Playback ────────────────────────────────────────────────────────
  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    audio.addEventListener('timeupdate', () =>
      dispatch({ type: 'POSITION', seconds: audio.currentTime }),
    );
    // Ends → stay paused-at-end so replay is allowed (spec §3).
    audio.addEventListener('ended', () => dispatch({ type: 'PLAYBACK_PAUSED' }));
    audio.addEventListener('error', () => {
      const track = stateRef.current.track;
      if (!track) return;
      if (urlRetriedRef.current) {
        toast.error('Could not play this recording.');
        dispatch({ type: 'CLOSE' });
        return;
      }
      urlRetriedRef.current = true;
      const resumeAt = stateRef.current.positionSec;
      void signedRecordingUrl(track.storagePath).then((url) => {
        if (!url) return;
        audio.src = url;
        audio.currentTime = resumeAt;
        void audio.play();
      });
    });
    audioRef.current = audio;
    return audio;
  }, []);

  const playRecording = useCallback(
    async (rec: NoteRecording) => {
      if (stateRef.current.mode === 'recording') return; // exclusivity
      const url = await signedRecordingUrl(rec.storagePath);
      if (!url) {
        toast.error('Could not load this recording.');
        return;
      }
      const audio = ensureAudio();
      urlRetriedRef.current = false;
      audio.src = url;
      audio.playbackRate = stateRef.current.speed;
      audio.currentTime = 0;
      dispatch({
        type: 'PLAY_TRACK',
        track: {
          recordingId: rec.id, noteId: rec.noteId, label: recordingLabel(rec),
          durationSeconds: rec.durationSeconds, storagePath: rec.storagePath,
        },
      });
      void audio.play();
    },
    [ensureAudio],
  );

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !stateRef.current.track) return;
    if (stateRef.current.mode === 'playing') {
      audio.pause();
      dispatch({ type: 'PLAYBACK_PAUSED' });
    } else {
      void audio.play();
      dispatch({ type: 'PLAYBACK_PLAYING' });
    }
  }, []);

  const seekTo = useCallback((sec: number) => {
    const audio = audioRef.current;
    const track = stateRef.current.track;
    if (!audio || !track) return;
    const clamped = Math.min(Math.max(sec, 0), track.durationSeconds);
    audio.currentTime = clamped;
    dispatch({ type: 'POSITION', seconds: clamped });
  }, []);

  const skipBy = useCallback(
    (deltaSec: number) => seekTo(stateRef.current.positionSec + deltaSec),
    [seekTo],
  );

  const setSpeed = useCallback((speed: number) => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
    dispatch({ type: 'SPEED', speed });
  }, []);

  const closeDock = useCallback(() => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.src = '';
    dispatch({ type: 'CLOSE' });
  }, []);

  const stopIfCurrent = useCallback(
    (recordingId: string) => {
      if (stateRef.current.track?.recordingId === recordingId) closeDock();
    },
    [closeDock],
  );

  // Native leave-confirmation while capturing or upload-pending (spec §2).
  const captureActive =
    state.mode === 'recording' ||
    state.recorder?.status === 'uploading' ||
    state.recorder?.status === 'failed';
  useEffect(() => {
    if (!captureActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [captureActive]);

  const value = useMemo<RecordingsAudioValue>(
    () => ({
      ...state,
      startRecording, pauseRecording, resumeRecording, stopRecording, cancelRecording,
      retryUpload, discardRecording, playRecording, togglePlayback,
      seekTo, skipBy, setSpeed, closeDock, stopIfCurrent,
    }),
    [
      state, startRecording, pauseRecording, resumeRecording, stopRecording,
      cancelRecording, retryUpload, discardRecording, playRecording,
      togglePlayback, seekTo, skipBy, setSpeed, closeDock, stopIfCurrent,
    ],
  );

  return (
    <RecordingsAudioContext.Provider value={value}>{children}</RecordingsAudioContext.Provider>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/notepad/recordings/audio-context.test.tsx`
Expected: PASS (13 tests). If the upload assertions race, add one more `await Promise.resolve()` inside the failing `act` — promise chains need explicit microtask flushes under fake timers.

- [ ] **Step 6: Lint + commit**

```bash
npx eslint src/notepad/recordings/audio-context.tsx src/notepad/recordings/fakes.ts src/notepad/recordings/audio-context.test.tsx
git add src/notepad/recordings/audio-context.tsx src/notepad/recordings/fakes.ts src/notepad/recordings/audio-context.test.tsx
git commit -m "feat(recordings): global audio context — recorder session + playback state"
```

---

### Task 4: `RecordingsDock.tsx`

**Files:**
- Create: `src/notepad/recordings/RecordingsDock.tsx`
- Test: `src/notepad/recordings/RecordingsDock.test.tsx`

**Interfaces:**
- Consumes: `useRecordingsAudio()` (Task 3) — `mode`, `recorder`, `track`, `positionSec`, `speed`, `pauseRecording`, `resumeRecording`, `stopRecording`, `cancelRecording`, `togglePlayback`, `seekTo`, `skipBy`, `setSpeed`, `closeDock`.
- Produces: `RecordingsDock({ variant, onOpenNote }: { variant: 'desktop' | 'mobile'; onOpenNote?: (noteId: string) => void })` — renders `null` when idle (mounted by Task 6).

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
// src/notepad/recordings/RecordingsDock.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RecordingsDock } from './RecordingsDock';
import { RecordingsAudioProvider, useRecordingsAudio, type RecordingsAudioValue } from './audio-context';
import { installMediaFakes, FakeAudio } from './fakes';
import type { NoteRecording } from './recordings-client';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'user-1' }, adapter: null, session: null }),
}));
const client = vi.hoisted(() => ({ signedRecordingUrl: vi.fn(), uploadRecording: vi.fn() }));
vi.mock('./recordings-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recordings-client')>()),
  signedRecordingUrl: client.signedRecordingUrl,
  uploadRecording: client.uploadRecording,
}));

const rec: NoteRecording = {
  id: 'rec-1', noteId: 'note-1', title: 'Psalm 23', durationSeconds: 120,
  storagePath: 'user-1/note-1/rec-1.webm', mimeType: 'audio/webm',
  sizeBytes: 100, createdAt: '2026-07-03T12:00:00Z',
};

let ctx: RecordingsAudioValue;
function Capture() { ctx = useRecordingsAudio(); return null; }

function mount(onOpenNote = vi.fn()) {
  render(
    <RecordingsAudioProvider>
      <Capture />
      <RecordingsDock variant="desktop" onOpenNote={onOpenNote} />
    </RecordingsAudioProvider>,
  );
  return onOpenNote;
}

let fakes: ReturnType<typeof installMediaFakes>;
beforeEach(() => {
  fakes = installMediaFakes();
  client.signedRecordingUrl.mockResolvedValue('https://signed.example/a.webm');
});
afterEach(() => {
  fakes.restore();
  vi.clearAllMocks();
});

describe('RecordingsDock', () => {
  it('renders nothing while idle', () => {
    mount();
    expect(screen.queryByTestId('recordings-dock')).toBeNull();
  });

  it('shows the recorder bar with a timer while recording', async () => {
    mount();
    await act(async () => { await ctx.startRecording('note-1'); });
    expect(screen.getByTestId('recordings-dock')).toBeInTheDocument();
    expect(screen.getByText('0:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause recording' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save recording' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard recording' })).toBeInTheDocument();
  });

  it('player bar: play/pause, ±15s skip, close', async () => {
    mount();
    await act(async () => { await ctx.playRecording(rec); });
    const audio = FakeAudio.instances[0];

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(audio.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(audio.play).toHaveBeenCalledTimes(2); // initial + resume

    act(() => ctx.seekTo(30));
    fireEvent.click(screen.getByRole('button', { name: 'Back 15 seconds' }));
    expect(audio.currentTime).toBe(15);
    fireEvent.click(screen.getByRole('button', { name: 'Forward 15 seconds' }));
    expect(audio.currentTime).toBe(30);

    fireEvent.click(screen.getByRole('button', { name: 'Close player' }));
    expect(screen.queryByTestId('recordings-dock')).toBeNull();
  });

  it('scrubber seeks and shows elapsed/total', async () => {
    mount();
    await act(async () => { await ctx.playRecording(rec); });
    expect(screen.getByText('0:00')).toBeInTheDocument();
    expect(screen.getByText('2:00')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '45' } });
    expect(FakeAudio.instances[0].currentTime).toBe(45);
    expect(screen.getByText('0:45')).toBeInTheDocument();
  });

  it('speed control applies the playback rate', async () => {
    mount();
    await act(async () => { await ctx.playRecording(rec); });
    // Cycle: 1× → 1.25×
    fireEvent.click(screen.getByRole('button', { name: 'Playback speed' }));
    expect(FakeAudio.instances[0].playbackRate).toBe(1.25);
    expect(screen.getByText('1.25×')).toBeInTheDocument();
  });

  it('clicking the source note name navigates', async () => {
    const onOpenNote = mount();
    await act(async () => { await ctx.playRecording(rec); });
    fireEvent.click(screen.getByRole('button', { name: 'Go to note' }));
    expect(onOpenNote).toHaveBeenCalledWith('note-1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/notepad/recordings/RecordingsDock.test.tsx`
Expected: FAIL — cannot resolve `./RecordingsDock`.

- [ ] **Step 3: Write the implementation**

Design notes baked in below: the speed control is a **cycle button** stepping through 0.75 → 1 → 1.25 → 1.5 → 2 → 0.75 (all five spec values reachable, and it avoids radix-menu pointer-event flakiness in jsdom); the dock is a flex footer (Deviations #3); recorder bar takes precedence over player bar (mode `'recording'` clears playback in the reducer anyway).

```tsx
// src/notepad/recordings/RecordingsDock.tsx
// Docked recorder/playback bar (spec §3). Renders null when idle — mounted as
// a shrink-0 flex footer in each workspace (desktop <main>; mobile above
// MobileTabBar), so visible content shrinks instead of being covered.
import { Pause, Play, RotateCcw, RotateCw, Square, X } from 'lucide-react';
import { useRecordingsAudio } from './audio-context';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const barStyle: React.CSSProperties = {
  borderTop: '1px solid var(--pale-stone)',
  background: 'var(--notepad-bar-bg)',
  fontFamily: 'Outfit, sans-serif',
  color: 'var(--deep-umber)',
};

function IconButton({
  label, onClick, children,
}: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex items-center justify-center w-8 h-8 rounded hover:bg-black/5 dark:hover:bg-white/10"
      style={{ color: 'var(--deep-umber)' }}
    >
      {children}
    </button>
  );
}

export function RecordingsDock({
  variant, onOpenNote,
}: { variant: 'desktop' | 'mobile'; onOpenNote?: (noteId: string) => void }) {
  const {
    mode, recorder, track, positionSec, speed,
    pauseRecording, resumeRecording, stopRecording, cancelRecording,
    togglePlayback, seekTo, skipBy, setSpeed, closeDock,
  } = useRecordingsAudio();

  if (mode === 'recording' && recorder) {
    const paused = recorder.status === 'rec-paused';
    return (
      <div data-testid="recordings-dock" className="shrink-0 flex items-center gap-3 px-4 py-2" style={barStyle}>
        <span
          aria-hidden
          className={`w-2 h-2 rounded-full ${paused ? '' : 'animate-pulse'}`}
          style={{ background: '#c0392b' }}
        />
        <span className="text-[12px] tabular-nums">{formatClock(recorder.elapsedSec)}</span>
        <span className="text-[11px]" style={{ color: 'var(--silica)' }}>
          {paused ? 'Paused' : 'Recording…'}
        </span>
        <div className="flex-1" />
        {paused ? (
          <IconButton label="Resume recording" onClick={resumeRecording}><Play size={15} /></IconButton>
        ) : (
          <IconButton label="Pause recording" onClick={pauseRecording}><Pause size={15} /></IconButton>
        )}
        <IconButton label="Save recording" onClick={stopRecording}><Square size={15} /></IconButton>
        <IconButton label="Discard recording" onClick={cancelRecording}><X size={15} /></IconButton>
      </div>
    );
  }

  if (!track || (mode !== 'playing' && mode !== 'paused')) return null;

  const nextSpeed = () => {
    const idx = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  const scrubber = (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <span className="text-[11px] tabular-nums" style={{ color: 'var(--silica)' }}>
        {formatClock(positionSec)}
      </span>
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={track.durationSeconds}
        step={1}
        value={Math.min(positionSec, track.durationSeconds)}
        onChange={(e) => seekTo(Number(e.target.value))}
        className="flex-1 min-w-0 accent-[var(--deep-umber)]"
      />
      <span className="text-[11px] tabular-nums" style={{ color: 'var(--silica)' }}>
        {formatClock(track.durationSeconds)}
      </span>
    </div>
  );

  const controls = (
    <div className="flex items-center gap-1">
      <IconButton label="Back 15 seconds" onClick={() => skipBy(-15)}><RotateCcw size={15} /></IconButton>
      {mode === 'playing' ? (
        <IconButton label="Pause" onClick={togglePlayback}><Pause size={16} /></IconButton>
      ) : (
        <IconButton label="Play" onClick={togglePlayback}><Play size={16} /></IconButton>
      )}
      <IconButton label="Forward 15 seconds" onClick={() => skipBy(15)}><RotateCw size={15} /></IconButton>
      <button
        type="button"
        aria-label="Playback speed"
        onClick={nextSpeed}
        className="px-1.5 h-8 rounded text-[11px] tabular-nums hover:bg-black/5 dark:hover:bg-white/10"
        style={{ color: 'var(--deep-umber)' }}
      >
        {speed}×
      </button>
      <IconButton label="Close player" onClick={closeDock}><X size={15} /></IconButton>
    </div>
  );

  const title = (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[12px] truncate">{track.label}</span>
      {onOpenNote && (
        <button
          type="button"
          aria-label="Go to note"
          onClick={() => onOpenNote(track.noteId)}
          className="text-[11px] underline underline-offset-2 shrink-0"
          style={{ color: 'var(--silica)' }}
        >
          Open note
        </button>
      )}
    </div>
  );

  if (variant === 'mobile') {
    return (
      <div data-testid="recordings-dock" className="shrink-0 flex flex-col gap-1 px-3 py-2" style={barStyle}>
        {scrubber}
        <div className="flex items-center justify-between gap-2">
          {title}
          {controls}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="recordings-dock" className="shrink-0 flex items-center gap-4 px-4 py-2" style={barStyle}>
      <div className="w-56 shrink-0">{title}</div>
      {scrubber}
      {controls}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/notepad/recordings/RecordingsDock.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint src/notepad/recordings/RecordingsDock.tsx src/notepad/recordings/RecordingsDock.test.tsx
git add src/notepad/recordings/RecordingsDock.tsx src/notepad/recordings/RecordingsDock.test.tsx
git commit -m "feat(recordings): docked recorder/player bar"
```

---

### Task 5: `RecordingsStrip.tsx` + `useNoteRecordings`

**Files:**
- Create: `src/notepad/recordings/useNoteRecordings.ts`
- Create: `src/notepad/recordings/RecordingsStrip.tsx`
- Test: `src/notepad/recordings/RecordingsStrip.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`listRecordings`, `renameRecording`, `deleteRecording`, `NoteRecording`), Task 3 (`useRecordingsAudio`, `recordingLabel`), `useAuthSession()`, ui primitives `@/components/ui/alert-dialog` + `@/components/ui/dropdown-menu`, `toast` from `sonner`, `formatClock` from Task 4.
- Produces: `RecordingsStrip({ noteId }: { noteId: string })` (mounted by Task 6); `useNoteRecordings(noteId): { recordings: NoteRecording[]; applyRename(id, title): void; applyDelete(id): void }`.

- [ ] **Step 1: Write the failing tests**

The strip's context dependency is mocked at the hook level (full state control without driving a real MediaRecorder):

```tsx
// @vitest-environment jsdom
// src/notepad/recordings/RecordingsStrip.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecordingsStrip } from './RecordingsStrip';
import { initialAudioState } from './audio-context';
import type { NoteRecording } from './recordings-client';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const auth = vi.hoisted(() => ({ user: { id: 'user-1' } as { id: string } | null }));
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: auth.user, adapter: null, session: null }),
}));

const client = vi.hoisted(() => ({
  listRecordings: vi.fn(),
  renameRecording: vi.fn(),
  deleteRecording: vi.fn(),
}));
vi.mock('./recordings-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recordings-client')>()),
  listRecordings: client.listRecordings,
  renameRecording: client.renameRecording,
  deleteRecording: client.deleteRecording,
}));

const audio = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock('./audio-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./audio-context')>()),
  useRecordingsAudio: () => audio.value,
}));

const rec: NoteRecording = {
  id: 'rec-1', noteId: 'note-1', title: '', durationSeconds: 83,
  storagePath: 'user-1/note-1/rec-1.webm', mimeType: 'audio/webm',
  sizeBytes: 100, createdAt: '2026-07-03T12:00:00Z',
};

beforeEach(() => {
  auth.user = { id: 'user-1' };
  client.listRecordings.mockResolvedValue([rec]);
  client.renameRecording.mockResolvedValue(undefined);
  client.deleteRecording.mockResolvedValue(undefined);
  audio.value = {
    ...initialAudioState,
    startRecording: vi.fn(async () => 'ok'),
    playRecording: vi.fn(async () => undefined),
    retryUpload: vi.fn(),
    discardRecording: vi.fn(),
    stopIfCurrent: vi.fn(),
  };
});
afterEach(() => vi.clearAllMocks());

describe('RecordingsStrip visibility states', () => {
  it('signed out: muted sign-in nudge, no Record button', async () => {
    auth.user = null;
    render(<RecordingsStrip noteId="note-1" />);
    expect(await screen.findByText('Sign in to record voice notes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record voice note' })).toBeNull();
  });

  it('signed in, no recordings: compact Record button only', async () => {
    client.listRecordings.mockResolvedValue([]);
    render(<RecordingsStrip noteId="note-1" />);
    expect(await screen.findByRole('button', { name: 'Record voice note' })).toBeInTheDocument();
    expect(screen.queryByTestId('recording-chip')).toBeNull();
  });

  it('with recordings: chips + Record button, date-label fallback and duration', async () => {
    render(<RecordingsStrip noteId="note-1" />);
    expect(await screen.findByText('Jul 3, 2026')).toBeInTheDocument();
    expect(screen.getByText('1:23')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record voice note' })).toBeInTheDocument();
  });
});

describe('chip interactions', () => {
  it('clicking a chip plays it', async () => {
    render(<RecordingsStrip noteId="note-1" />);
    fireEvent.click(await screen.findByText('Jul 3, 2026'));
    expect(audio.value.playRecording).toHaveBeenCalledWith(rec);
  });

  it('inline rename: Enter saves', async () => {
    render(<RecordingsStrip noteId="note-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recording options' }));
    fireEvent.click(await screen.findByText('Rename'));
    const input = screen.getByRole('textbox', { name: 'Recording title' });
    fireEvent.change(input, { target: { value: 'Evening prayer' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(client.renameRecording).toHaveBeenCalledWith('rec-1', 'Evening prayer'));
    expect(await screen.findByText('Evening prayer')).toBeInTheDocument();
  });

  it('inline rename: Escape cancels', async () => {
    render(<RecordingsStrip noteId="note-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recording options' }));
    fireEvent.click(await screen.findByText('Rename'));
    const input = screen.getByRole('textbox', { name: 'Recording title' });
    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(client.renameRecording).not.toHaveBeenCalled();
    expect(screen.getByText('Jul 3, 2026')).toBeInTheDocument();
  });

  it('delete: AlertDialog confirm stops playback then deletes', async () => {
    render(<RecordingsStrip noteId="note-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recording options' }));
    fireEvent.click(await screen.findByText('Delete'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(client.deleteRecording).toHaveBeenCalledWith(rec));
    expect(audio.value.stopIfCurrent).toHaveBeenCalledWith('rec-1');
    await waitFor(() => expect(screen.queryByTestId('recording-chip')).toBeNull());
  });
});

describe('recording / upload states', () => {
  it('mic permission denied shows the inline blocked message', async () => {
    (audio.value.startRecording as ReturnType<typeof vi.fn>).mockResolvedValue('permission-denied');
    render(<RecordingsStrip noteId="note-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record voice note' }));
    expect(
      await screen.findByText('Microphone access is blocked — enable it in your browser settings'),
    ).toBeInTheDocument();
  });

  it('while recording on this note: Record button replaced, chips inert', async () => {
    audio.value = {
      ...audio.value,
      mode: 'recording',
      recorder: { noteId: 'note-1', status: 'recording', elapsedSec: 3, uploadProgress: 0, error: null, mimeType: 'audio/webm' },
    };
    render(<RecordingsStrip noteId="note-1" />);
    expect(await screen.findByText('Recording…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record voice note' })).toBeNull();
    fireEvent.click(screen.getByText('Jul 3, 2026'));
    expect(audio.value.playRecording).not.toHaveBeenCalled();
  });

  it('pending chip shows progress, then Retry / Discard on failure', async () => {
    audio.value = {
      ...audio.value,
      recorder: { noteId: 'note-1', status: 'uploading', elapsedSec: 8, uploadProgress: 0.4, error: null, mimeType: 'audio/webm' },
    };
    const { rerender } = render(<RecordingsStrip noteId="note-1" />);
    expect(await screen.findByText('Uploading… 40%')).toBeInTheDocument();

    audio.value = {
      ...audio.value,
      recorder: { ...(audio.value.recorder as object), status: 'failed', error: 'offline' } as never,
    };
    rerender(<RecordingsStrip noteId="note-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
    expect(audio.value.retryUpload).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard failed recording' }));
    expect(audio.value.discardRecording).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/notepad/recordings/RecordingsStrip.test.tsx`
Expected: FAIL — cannot resolve `./RecordingsStrip`.

- [ ] **Step 3: Write `useNoteRecordings.ts`**

```ts
// src/notepad/recordings/useNoteRecordings.ts
// Recordings for one note: fetch on mount and after every completed upload
// (savedVersion bump); rename/delete update locally (spec §4).
import { useCallback, useEffect, useState } from 'react';
import { listRecordings, type NoteRecording } from './recordings-client';
import { useRecordingsAudio } from './audio-context';

export function useNoteRecordings(noteId: string) {
  const { savedVersion } = useRecordingsAudio();
  const [recordings, setRecordings] = useState<NoteRecording[]>([]);

  useEffect(() => {
    let active = true;
    listRecordings(noteId)
      .then((recs) => { if (active) setRecordings(recs); })
      .catch((err) => console.warn('[recordings] list failed', err));
    return () => { active = false; };
  }, [noteId, savedVersion]);

  const applyRename = useCallback((id: string, title: string) => {
    setRecordings((prev) => prev.map((r) => (r.id === id ? { ...r, title } : r)));
  }, []);

  const applyDelete = useCallback((id: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { recordings, applyRename, applyDelete };
}
```

- [ ] **Step 4: Write `RecordingsStrip.tsx`**

```tsx
// src/notepad/recordings/RecordingsStrip.tsx
// Chips strip under the note title (spec §4). Satellite data — never touches
// the TipTap document. Signed-out users get a muted nudge (repo precedent:
// LamplightMobileView's plain sign-in line).
import { useState } from 'react';
import { Loader2, Mic, MoreVertical, Play } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthSession } from '@/auth/context/useAuthSession';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { recordingLabel, useRecordingsAudio } from './audio-context';
import { deleteRecording, renameRecording, type NoteRecording } from './recordings-client';
import { useNoteRecordings } from './useNoteRecordings';
import { formatClock } from './RecordingsDock';

const outfit = { fontFamily: 'Outfit, sans-serif' } as const;

const chipStyle: React.CSSProperties = {
  ...outfit,
  border: '1px solid var(--pale-stone)',
  background: 'color-mix(in srgb, var(--warm-sand) 12%, transparent)',
  color: 'var(--deep-umber)',
  borderRadius: 999,
};

function Chip({
  rec, inert, onRenamed, onDeleted,
}: {
  rec: NoteRecording;
  inert: boolean;
  onRenamed: (id: string, title: string) => void;
  onDeleted: (id: string) => void;
}) {
  const { track, mode, playRecording, stopIfCurrent } = useRecordingsAudio();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isPlaying = track?.recordingId === rec.id && mode === 'playing';

  const commitRename = async () => {
    const title = draft.trim();
    setRenaming(false);
    if (!title || title === rec.title) return;
    try {
      await renameRecording(rec.id, title);
      onRenamed(rec.id, title);
    } catch {
      toast.error('Could not rename the recording.');
    }
  };

  const confirmDelete = async () => {
    stopIfCurrent(rec.id); // playing? stop + close dock first (spec §4)
    try {
      await deleteRecording(rec);
      onDeleted(rec.id);
    } catch {
      toast.error('Could not delete the recording.');
    }
  };

  return (
    <span data-testid="recording-chip" className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1" style={chipStyle}>
      {renaming ? (
        <input
          aria-label="Recording title"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={() => setRenaming(false)}
          className="text-[11px] bg-transparent outline-none w-28"
          style={outfit}
        />
      ) : (
        <button
          type="button"
          disabled={inert}
          onClick={() => void playRecording(rec)}
          className="inline-flex items-center gap-1.5 disabled:opacity-50"
          style={outfit}
        >
          {isPlaying ? (
            <span aria-label="Playing" className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: 'var(--deep-umber)' }} />
          ) : (
            <Play size={11} />
          )}
          <span className="text-[11px]">{recordingLabel(rec)}</span>
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--silica)' }}>
            {formatClock(rec.durationSeconds)}
          </span>
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Recording options"
            className="flex items-center justify-center w-5 h-5 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: 'var(--silica)' }}
          >
            <MoreVertical size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" style={outfit}>
          <DropdownMenuItem onSelect={() => { setDraft(rec.title || ''); setRenaming(true); }}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem className="text-red-600 focus:text-red-600" onSelect={() => setDeleteOpen(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent style={outfit}>
          <AlertDialogHeader>
            <AlertDialogTitle style={outfit}>Delete Recording</AlertDialogTitle>
            <AlertDialogDescription style={outfit}>
              Are you sure you want to delete "{recordingLabel(rec)}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel style={outfit}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()} style={outfit}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}

export function RecordingsStrip({ noteId }: { noteId: string }) {
  const { user } = useAuthSession();
  const audio = useRecordingsAudio();
  const { recordings, applyRename, applyDelete } = useNoteRecordings(noteId);
  const [micBlocked, setMicBlocked] = useState(false);

  if (!user) {
    return (
      <div className="flex items-center gap-1.5 text-[11px]" style={{ ...outfit, color: 'var(--silica)', marginBottom: '0.75rem' }}>
        <Mic size={12} />
        Sign in to record voice notes
      </div>
    );
  }

  const recordingHere = audio.mode === 'recording' && audio.recorder?.noteId === noteId;
  const chipsInert = audio.mode === 'recording'; // everywhere (spec §4)
  const pending =
    audio.recorder && audio.recorder.noteId === noteId &&
    (audio.recorder.status === 'uploading' || audio.recorder.status === 'failed')
      ? audio.recorder
      : null;

  const handleRecord = async () => {
    setMicBlocked(false);
    const result = await audio.startRecording(noteId);
    if (result === 'permission-denied') setMicBlocked(true);
    if (result === 'busy') toast('Finish or discard the pending recording first.');
  };

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div className="flex flex-wrap items-center gap-1.5">
        {recordings.map((rec) => (
          <Chip key={rec.id} rec={rec} inert={chipsInert} onRenamed={applyRename} onDeleted={applyDelete} />
        ))}

        {pending && (
          <span data-testid="recording-chip" className="inline-flex items-center gap-1.5 px-2.5 py-1" style={chipStyle}>
            {pending.status === 'uploading' ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                <span className="text-[11px]">Uploading… {Math.round(pending.uploadProgress * 100)}%</span>
              </>
            ) : (
              <>
                <span className="text-[11px]" style={{ color: '#c0392b' }}>Upload failed</span>
                <button type="button" aria-label="Retry upload" onClick={audio.retryUpload} className="text-[11px] underline underline-offset-2" style={outfit}>
                  Retry
                </button>
                <button type="button" aria-label="Discard failed recording" onClick={audio.discardRecording} className="text-[11px] underline underline-offset-2" style={{ ...outfit, color: 'var(--silica)' }}>
                  Discard
                </button>
              </>
            )}
          </span>
        )}

        {recordingHere ? (
          <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ ...outfit, color: '#c0392b' }}>
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#c0392b' }} />
            Recording…
          </span>
        ) : (
          <button
            type="button"
            aria-label="Record voice note"
            disabled={chipsInert}
            onClick={() => void handleRecord()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] disabled:opacity-50"
            style={chipStyle}
          >
            <Mic size={11} />
            Record
          </button>
        )}
      </div>

      {micBlocked && (
        <div className="text-[11px] mt-1" style={{ ...outfit, color: '#c0392b' }}>
          Microphone access is blocked — enable it in your browser settings
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/notepad/recordings/RecordingsStrip.test.tsx`
Expected: PASS (10 tests). Note: the radix `DropdownMenu` opens on `fireEvent.click` of the trigger in jsdom; if the menu items don't appear, switch those two clicks to `fireEvent.pointerDown` + `fireEvent.click`.

- [ ] **Step 6: Lint + commit**

```bash
npx eslint src/notepad/recordings/RecordingsStrip.tsx src/notepad/recordings/useNoteRecordings.ts src/notepad/recordings/RecordingsStrip.test.tsx
git add src/notepad/recordings/RecordingsStrip.tsx src/notepad/recordings/useNoteRecordings.ts src/notepad/recordings/RecordingsStrip.test.tsx
git commit -m "feat(recordings): recordings strip with chips, rename, delete"
```

---

### Task 6: Mount provider, dock, and strip

**Files:**
- Modify: `src/components/sections/Notepad.tsx` (provider at `NotepadWorkspace` ~line 329; desktop dock inside `<main>` before its closing tag ~line 276)
- Modify: `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx` (dock directly above `<MobileTabBar …/>` ~line 225)
- Modify: `src/notepad/components/Editor.tsx` (strip after the Date div, ~line 520, before the Tags block)

**Interfaces:**
- Consumes: `RecordingsAudioProvider` (Task 3), `RecordingsDock` (Task 4), `RecordingsStrip` (Task 5).
- Produces: the running feature. The strip mounts ONCE in `Editor.tsx` — `MobileEditorView` renders the same shared `NotepadEditor`, so mobile is covered for free.

- [ ] **Step 1: Wrap the workspace in the provider** — in `Notepad.tsx`, add imports and change `NotepadWorkspace`:

```tsx
import { RecordingsAudioProvider } from '@/notepad/recordings/audio-context';
import { RecordingsDock } from '@/notepad/recordings/RecordingsDock';
```

```tsx
export function NotepadWorkspace() {
  const isMobile = useIsMobile();
  return (
    <RecordingsAudioProvider>
      <OnboardingProvider>
        {isMobile ? <MobileNotepadWorkspace /> : <DesktopNotepadWorkspace />}
        <NotepadOnboardingOverlay />
      </OnboardingProvider>
    </RecordingsAudioProvider>
  );
}
```

- [ ] **Step 2: Desktop dock** — in `DesktopNotepadWorkspace`, immediately after the Connection Cards strip conditional block and before `</main>`:

```tsx
          <RecordingsDock
            variant="desktop"
            onOpenNote={(id) => {
              collection.openNote(id);
              setActiveTab('content');
            }}
          />
        </main>
```

(`collection` and `setActiveTab` are already in scope. Note: when the graph is expanded, `<main>` collapses and the dock hides with it while audio keeps playing — accepted, see Deviations #3.)

- [ ] **Step 3: Mobile dock** — in `MobileNotepadWorkspace.tsx`, add `import { RecordingsDock } from '@/notepad/recordings/RecordingsDock';` and render directly above the tab bar:

```tsx
      <RecordingsDock variant="mobile" onOpenNote={handleOpenNote} />
      <MobileTabBar active={effectiveTab} onSelect={handleSelectTab} />
```

- [ ] **Step 4: Strip in the editor** — in `Editor.tsx`, add `import { RecordingsStrip } from '../recordings/RecordingsStrip';` and insert between the Date div's closing tag (~line 520) and the `{/* Tags */}` comment:

```tsx
          {/* Voice recordings — satellite data, not part of the TipTap doc */}
          <RecordingsStrip noteId={activeNote.id} />
```

- [ ] **Step 5: Run the FULL suite + lint touched files**

Run: `npx vitest run`
Expected: green — baseline 2700 passed | 38 skipped, plus the new recordings tests. Existing `Editor`/workspace tests that render these components must still pass; if any render outside a provider, wrap that test's render in `<RecordingsAudioProvider>` (it is side-effect-free while idle).

Run: `npx eslint src/components/sections/Notepad.tsx src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx src/notepad/components/Editor.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/components/sections/Notepad.tsx src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx src/notepad/components/Editor.tsx
git commit -m "feat(recordings): mount audio provider, dock, and strip in workspaces"
```

---

### Task 7: Note-delete storage cleanup in `SupabaseStorageAdapter`

**Files:**
- Modify: `src/notepad/storage/supabase-adapter.ts:114-117` (`deleteNote`)
- Test: `src/notepad/storage/supabase-adapter.recordings.test.ts` (new file — avoids colliding with any existing adapter tests)

**Interfaces:**
- Consumes: `removeRecordingsForNote(userId, noteId)` from Task 2 (never throws); adapter fields `#client`, `#userId` (constructor `new SupabaseStorageAdapter(client, userId)`).

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/storage/supabase-adapter.recordings.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseStorageAdapter } from './supabase-adapter';
import type { SupabaseClient } from '@supabase/supabase-js';

const cleanup = vi.hoisted(() => ({ removeRecordingsForNote: vi.fn(async () => undefined) }));
vi.mock('../recordings/recordings-client', () => ({
  removeRecordingsForNote: cleanup.removeRecordingsForNote,
}));

function makeClient(deleteError: { message: string } | null = null) {
  const eq = vi.fn(async () => ({ error: deleteError }));
  const del = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ delete: del }));
  return { client: { from } as unknown as SupabaseClient, from, del, eq };
}

beforeEach(() => vi.clearAllMocks());

describe('SupabaseStorageAdapter.deleteNote recordings cleanup', () => {
  it('deletes the row first, then best-effort storage cleanup', async () => {
    const { client, eq } = makeClient();
    const adapter = new SupabaseStorageAdapter(client, 'user-1');
    await adapter.deleteNote('note-1');
    expect(eq).toHaveBeenCalledWith('id', 'note-1');
    expect(cleanup.removeRecordingsForNote).toHaveBeenCalledWith('user-1', 'note-1');
    expect(eq.mock.invocationCallOrder[0]).toBeLessThan(
      cleanup.removeRecordingsForNote.mock.invocationCallOrder[0],
    );
  });

  it('row-delete failure throws and skips cleanup', async () => {
    const { client } = makeClient({ message: 'nope' });
    const adapter = new SupabaseStorageAdapter(client, 'user-1');
    await expect(adapter.deleteNote('note-1')).rejects.toBeTruthy();
    expect(cleanup.removeRecordingsForNote).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/storage/supabase-adapter.recordings.test.ts`
Expected: FAIL — `removeRecordingsForNote` not called.

- [ ] **Step 3: Implement** — add the import and extend `deleteNote`:

```ts
import { removeRecordingsForNote } from '../recordings/recordings-client';
```

```ts
  async deleteNote(id: string): Promise<void> {
    const { error } = await this.#client.from('notes').delete().eq('id', id);
    if (error) throw error;
    // DB rows cascade; storage objects don't. Best-effort — never blocks
    // deletion (removeRecordingsForNote never throws). Spec §1.
    await removeRecordingsForNote(this.#userId, id);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/notepad/storage/supabase-adapter.recordings.test.ts` → PASS (2 tests), then `npx vitest run` → full suite green.

- [ ] **Step 5: Lint + commit**

```bash
npx eslint src/notepad/storage/supabase-adapter.ts src/notepad/storage/supabase-adapter.recordings.test.ts
git add src/notepad/storage/supabase-adapter.ts src/notepad/storage/supabase-adapter.recordings.test.ts
git commit -m "feat(recordings): clean up recording objects when a note is deleted"
```

---

### Task 8: Apply migration + manual preview checklist

Browser-native behavior is deliberately not unit-tested (spec §5). This task needs the user in the loop.

- [ ] **Step 1: Ask the user to apply `043_note_recordings.sql`** to the hosted Supabase project (SQL editor or their usual CLI flow). Verify: `note_recordings` table exists, `note-recordings` bucket exists and is private.
- [ ] **Step 2: Start the preview server** — config name `psalms-app` (preview_start). Sign in.
- [ ] **Step 3: Chrome (webm) pass:** record a short note-attached clip (timer counts, pause/resume works), chip appears with progress → saved; play it in the dock (scrubber, ±15s, speed cycle); navigate to another note mid-playback — dock persists; click "Open note" returns.
- [ ] **Step 4: Denied-permission state:** block mic for the site → Record shows the inline blocked message, no modal.
- [ ] **Step 5: Offline upload failure:** DevTools → Network → Offline, stop a recording → chip shows Retry/Discard; back online → Retry succeeds.
- [ ] **Step 6: 30-minute cap** (optional, or temporarily lower `MAX_RECORDING_SECONDS` locally): auto-stop saves with a toast.
- [ ] **Step 7: Mobile viewport:** dock stacks directly above `MobileTabBar`; strip renders in the mobile editor; two-row dock layout.
- [ ] **Step 8: Note delete:** delete a note with recordings → note gone, no console errors; storage folder emptied (check Supabase dashboard).
- [ ] **Step 9: Safari (mp4) pass when available.**
- [ ] **Step 10:** Fix anything found (TDD for logic bugs), then final `npx vitest run` + commit fixes.

---

## Task order & dependencies

1 (migration) → 2 (client) → 3 (audio context) → 4 (dock) → 5 (strip) → 6 (mounts) → 7 (delete cleanup — only needs 2) → 8 (manual). Task 7 can run any time after Task 2.



