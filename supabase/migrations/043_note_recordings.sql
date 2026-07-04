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
