-- 059_artifact_library_provenance.sql — record which library excerpts shaped an
-- artifact (depth overhaul, slice 1b; consumed by slices 1c and 1d).
--
-- Sits alongside the existing provenance columns (source_note_ids,
-- source_verses, model_used, prompt_version) that the "How this was written"
-- panel renders. Nothing writes this column until slice 1c; it lands now so 1c
-- is a pure code change.
--
-- Shape: [{ "chunk_id": uuid, "source_id": text, "heading": text }]
--
-- `heading` is SNAPSHOTTED rather than joined at read time on purpose — a
-- re-ingest can rotate library_chunks ids, and a provenance record that stops
-- rendering after a corpus refresh would be worse than a slightly stale label.
-- null means "no library retrieval ran for this artifact"; an empty array means
-- "it ran and nothing was used" — the panel distinguishes them.

alter table public.lamplight_artifacts
  add column source_library_chunks jsonb;

comment on column public.lamplight_artifacts.source_library_chunks is
  'Library excerpts supplied to the generation, as [{chunk_id, source_id, heading}]. null = retrieval did not run; [] = ran, nothing used.';
