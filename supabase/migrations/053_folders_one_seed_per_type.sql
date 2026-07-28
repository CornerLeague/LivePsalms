-- Stop two tabs (or devices) that seed the same legacy account at the same time
-- from each creating the full type-folder set. The one-time backfill reads the
-- folder list, sees none, and creates one folder per used note type; run twice
-- concurrently it would produce duplicate folders with notes split across them.
--
-- At most one seeded folder per note type per user. seeded_type is null for
-- user-made and system (Study) folders, so this only constrains folders the
-- backfill creates (migration 052) and never conflicts with existing rows. The
-- losing concurrent insert hits this index and the backfill adopts the folder
-- that already exists instead (see NotepadActions.applyTypeFolderSeed), the same
-- way ensureStudyFolder recovers from a 23505 via folders_one_study_per_user.
create unique index if not exists folders_one_seed_per_type_per_user
  on public.folders (user_id, seeded_type)
  where seeded_type is not null;
