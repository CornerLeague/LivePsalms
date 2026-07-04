-- 044_note_recordings_hardening.sql
-- Server-side hardening follow-ups from PR #73 review (043 is already applied,
-- so these land as a separate migration):
--
-- 1) Constrain note_recordings.note_id to notes the caller owns. FK validation
--    runs as table owner (bypasses RLS), so without this a caller who knows
--    another user's note UUID could attach a recording row they own to that
--    note — invisible to the victim (SELECT is owner-scoped) but it breaks the
--    owner-only attachment invariant and leaks note-UUID existence via FK
--    errors. Applied to both INSERT and UPDATE with check, so a row can't be
--    re-pointed at a foreign note either.
--
-- 2) Bucket limits: the 30-minute recording cap is client-enforced only; give
--    the bucket a server-side size ceiling and an audio-only mime allowlist.
--    Safe for real uploads: the client always sends the normalized container
--    type ('audio/webm' | 'audio/mp4'), never the codec-suffixed string.

drop policy if exists "Users can create own recordings" on note_recordings;
create policy "Users can create own recordings"
  on note_recordings for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes
      where notes.id = note_recordings.note_id
        and notes.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own recordings" on note_recordings;
create policy "Users can update own recordings"
  on note_recordings for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes
      where notes.id = note_recordings.note_id
        and notes.user_id = auth.uid()
    )
  );

-- 60 MB ceiling (~2x a 30-minute opus/AAC voice note) + audio-only mime types.
update storage.buckets
  set file_size_limit = 62914560,
      allowed_mime_types = array['audio/webm', 'audio/mp4']
  where id = 'note-recordings';
