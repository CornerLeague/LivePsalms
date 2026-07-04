# Voice Recordings in Notes — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorm), ready for implementation plan
**Working title:** Voice recordings (surfaced in UI as a **recordings strip** + docked player)
**Visual mockups:** `.superpowers/brainstorm/15336-1783112761/content/` (`recording-placement.html`, `playback-ux.html`)

## Summary

Signed-in users can record voice notes (in-app microphone capture) attached to a
journal note. Recordings appear as a **strip of chips under the note title** —
alongside the note, not inside the TipTap document — with a Record button at the
end. Playback happens in a **docked mini-player** at the bottom of the workspace
whose state is global: it survives navigating between notes and is the single
player surface, with full controls (scrubber, ±15s skip, playback speed).

Audio is stored in a **private Supabase Storage bucket** with a companion
`note_recordings` table (RLS, owner-only), mirroring the handwriting-scan
feature's storage design (`019_note_transcriptions.sql`).

## Goals

- Capture spoken reflections against a note with minimal friction (one tap,
  visible timer, pause/resume).
- Keep recordings first-class but *satellite* data — the note document format is
  untouched.
- One always-available player surface that doesn't trap the user on the note
  they recorded on.
- Robust upload: progress feedback, retry on failure, nothing silently lost.

## Non-goals (YAGNI — explicitly out of v1)

- **File upload** of existing audio — record-only via MediaRecorder.
- **Transcription** — parked unless the user raises it (Lamplight AI infra
  exists as an adjacency).
- **Anonymous/local-mode audio** — no IndexedDB layer, no migration-workflow
  changes. Signed-out users see a sign-in nudge instead of the Record button.
- Realtime sync of the recordings list across tabs/devices.
- Persisting playback speed as a stored preference (session-only).
- Waveform visualization.

## User-confirmed decisions

1. **Placement:** note-level recordings strip under the note title (chips +
   Record button), like the `decorations` satellite-data concept — NOT inline
   TipTap nodes.
2. **Audience:** signed-in only. Anonymous users get a gentle sign-in nudge.
3. **Duration cap:** 30 minutes, with pause/resume and a visible timer.
4. **Playback:** docked mini-player, global state, full controls; on mobile it
   stacks **above** `MobileBottomDock`.
5. **Scope:** record-only; no file upload; no transcription.
6. **Architecture:** deliberately **bypasses `StorageAdapter`** — that
   abstraction exists for anonymous/local parity, and this feature is
   signed-in-only; threading it through would force dead stubs into
   `local-storage.ts`.

## Section 1 — Data model, storage, and migration

**Migration `supabase/migrations/043_note_recordings.sql`** (latest existing is
042), modeled directly on `019_note_transcriptions.sql`:

```sql
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
```

- `note_id` uses `on delete cascade` (unlike scans' `set null`) — a recording
  has no life outside its note.
- Indexes on `note_id` and `user_id`; RLS enabled with the same four owner-only
  policies as 019; `update_updated_at()` trigger (rename touches `updated_at`).
- **Private bucket `note-recordings`** created in the same migration, with the
  same four storage policies keyed on
  `(storage.foldername(name))[1] = auth.uid()::text`. Object path
  `{userId}/{noteId}/{recordingId}.<ext>` puts userId first so the policy
  pattern works unchanged.

**Client module `src/notepad/recordings/recordings-client.ts`**, mirroring
`src/notepad/scan/transcription-client.ts`: plain module functions, `supabase`
from `src/lib/supabase` with null guards, object-key helper, upload (signed
upload URL + XHR, see Section 2), `createSignedUrl` for playback, list-by-note,
rename, delete (storage object first, then row — mirroring `discardScan`'s
order), and `removeRecordingsForNote(userId, noteId)`.

**Note-delete cleanup:** DB rows cascade automatically; storage objects don't.
The signed-in note-delete path (`notepad-actions`) calls
`removeRecordingsForNote`, which lists the `{userId}/{noteId}/` folder and
removes all objects. This is **best-effort**: log a warning on failure, never
block note deletion — an orphaned object in a private bucket is invisible and
cheap; a note that refuses to delete is bad UX. Folder deletion is safe as-is:
`notes.folder_id` is `on delete set null`, so notes and their recordings
survive folder deletion.

## Section 2 — Recording capture flow

**Starting.** The strip's Record button calls `getUserMedia({ audio: true })`.
Permission denied → inline message in the strip ("Microphone access is blocked —
enable it in your browser settings"), no modal. MIME negotiation:
`MediaRecorder.isTypeSupported('audio/webm;codecs=opus')` → webm, else
`audio/mp4` (Safari). Chunks accumulate in memory via `start(1000)` timeslice —
a 30-minute opus recording is roughly 7–15 MB.

**Session state lives in the global audio context** (Section 3), not the note
view. You can't record and play at once, so one shared context makes the
exclusivity natural, and navigating between notes mid-recording doesn't kill
the MediaRecorder. While recording, the **docked bar becomes the recorder bar**
— timer (MM:SS), pause/resume, stop, cancel — and the finished chip appears in
the originating note's strip. The strip is the entry point; the docked bar is
the in-progress surface.

**Cap:** at 30:00 the recording auto-stops and saves (never discards), with a
toast. Duration is computed from elapsed recording time excluding pauses —
MediaRecorder webm duration metadata is unreliable, so we track it ourselves.

**Upload.** On stop: generate `recordingId` client-side (uuid), upload the blob
to `{userId}/{noteId}/{recordingId}.<ext>`, then insert the DB row. If the
insert fails, best-effort remove the object and surface retry. Progress uses
`createSignedUploadUrl` + XHR PUT for a real percentage — Safari files can hit
30–45 MB, where an indeterminate spinner feels broken.

**Failure handling.**
- Upload failure / offline: the blob and upload status live in the **global
  audio context** (the recorder session's lifecycle is
  record → upload → done/failed), so the pending chip's Retry / Discard
  affordance survives navigating away and back. Nothing lost until discard or
  tab close.
- Tab close while recording or upload-pending: `beforeunload` handler triggers
  the browser's native leave-confirmation. If they leave anyway, the recording
  is gone — accepted, since there is deliberately no IndexedDB layer.
- MediaRecorder `onerror` mid-recording (e.g. mic unplugged): stop, salvage the
  chunks collected so far, offer save/discard.

## Section 3 — Playback: audio context + docked bar

**`RecordingsAudioProvider`** in `src/notepad/recordings/`, modeled on the
existing context precedents (`src/notepad/bible/prefs/bible-prefs-context.ts`,
`src/notepad/sidebar/tree-view-state.tsx`), mounted at workspace level so it
survives navigation between notes. It owns both the recorder session
(Section 2) and playback. State is a small machine —
`idle | recording | playing | paused` — holding the current track's metadata
(id, noteId, title, duration), position, and speed, plus the recorder
session's upload status (Section 2). Exclusivity falls out for free: starting
a recording stops playback; chips are inert while recording.

**Audio element:** a single ref-held `Audio()` instance inside the provider (no
DOM `<audio>`). Playing a chip fetches a signed URL (1-hour expiry) via
`createSignedUrl`, sets `src`, plays. If a URL expires mid-session and errors:
re-fetch and resume at the saved position — one retry, then surface an error.

**`RecordingsDock`** renders only when state ≠ idle — no reserved space when
hidden; the workspace gets bottom padding while visible so content isn't
covered.

- **Desktop:** fixed bar at the bottom of the main workspace column. Left:
  title + source-note name (clicking navigates to that note). Center: scrubber
  with elapsed/total, ±15s skip flanking play/pause. Right: speed menu
  (0.75× / 1× / 1.25× / 1.5× / 2×, session-only) and close ×.
- **Mobile:** same component, stacked directly above `MobileBottomDock` (fixed,
  offset by the dock's height), condensed to two rows — scrubber on top,
  controls beneath.

**Edge behaviors:** when audio ends, the bar stays paused-at-end (replay
allowed); close resets to idle; deleting the currently-playing recording stops
playback and closes the bar.

## Section 4 — The recordings strip

**`RecordingsStrip`** in `src/notepad/recordings/`, rendered under the note
title (above the editor content), taking `noteId`. Data via a
`useNoteRecordings(noteId)` hook wrapping `recordings-client.listRecordings()`
— fetch on mount + update after add/rename/delete.

**Three states:**
- **Signed out:** one muted line — mic icon + "Sign in to record voice notes" —
  linking into the existing sign-in flow. No Record button.
- **Signed in, no recordings:** a compact Record button only.
- **With recordings:** a wrapping row of chips, Record button at the end.

**Chip anatomy:** play glyph + title + duration (`M:SS`); empty titles fall
back to a date label ("Jul 3, 2026"). Click → loads into the docked player;
the playing chip swaps to a playing indicator. A pending-upload chip shows
progress, then Retry / Discard on failure. Each chip has a kebab menu (hover on
desktop, always visible on mobile) with **Rename** and **Delete**.

- **Rename:** inline — label becomes an input; Enter saves, Escape cancels.
- **Delete:** `AlertDialog` confirmation, same pattern as note deletion in
  `src/notepad/sidebar/NoteItem.tsx`; storage object removed first, row second.
  If currently playing, playback stops and the dock closes first.

While a recording is in progress, the originating note's Record button is
replaced by a "Recording…" indicator, and chips everywhere are inert.

## Section 5 — Testing strategy

Repo conventions: vitest + testing-library, colocated `*.test.ts(x)`, lint
clean + full `npx vitest run` green before commit.

- **`recordings-client.test.ts`** — mock the `supabase` module: object-key
  generation, upload happy path, null-supabase guards, delete ordering (storage
  before row), error propagation, `removeRecordingsForNote` (list → remove,
  best-effort failure doesn't throw).
- **Audio context tests** — the state machine in isolation:
  recording/playback exclusivity, cap auto-stop at 30:00 (fake timers),
  duration tracking excluding paused time, URL-expiry retry-once logic.
  `MediaRecorder` / `getUserMedia` stubbed (absent in jsdom).
- **`RecordingsStrip.test.tsx`** — three visibility states, date-label
  fallback, inline rename (Enter/Escape), delete with confirm, pending-chip
  Retry / Discard.
- **`RecordingsDock.test.tsx`** — hidden when idle, controls dispatch
  correctly (play/pause, ±15s, speed), close resets state. `Audio()` stubbed.

**Deliberately not unit-tested:** real encoding, real uploads, actual mic
permissions — browser-native behavior. Manual preview checklist instead:
record in Chrome (webm), denied-permission state, offline upload failure,
mobile bar stacking above `MobileBottomDock`, Safari (mp4) pass when available.

## New-file inventory

| Path | Purpose |
| --- | --- |
| `supabase/migrations/043_note_recordings.sql` | Table + RLS + bucket + storage policies |
| `src/notepad/recordings/recordings-client.ts` | Supabase storage/table client functions |
| `src/notepad/recordings/audio-context.tsx` | `RecordingsAudioProvider` — recorder + player state |
| `src/notepad/recordings/RecordingsStrip.tsx` | Chips strip under note title |
| `src/notepad/recordings/RecordingsDock.tsx` | Docked recorder/player bar |
| Colocated `*.test.ts(x)` | Per Section 5 |

Touched existing files: note editor layout (mount strip), workspace layout
(mount provider + dock), `notepad-actions` (note-delete cleanup hook).
