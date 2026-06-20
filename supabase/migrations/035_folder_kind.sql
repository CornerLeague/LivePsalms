-- Mark the per-user system "Study" folder so Study mode can find/provision it.
-- kind is null for ordinary folders; 'study' for the single system Study folder.
alter table public.folders add column if not exists kind text;

-- At most one Study folder per user: gives idempotent provisioning + race safety
-- (a second concurrent insert hits this index and we re-fetch the existing row).
create unique index if not exists folders_one_study_per_user
  on public.folders (user_id)
  where kind = 'study';
