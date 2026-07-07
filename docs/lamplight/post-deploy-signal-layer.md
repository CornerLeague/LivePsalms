# Signal Layer — Post-Deploy Steps

After applying migration 011 in a fresh environment, run these once.

## 1. Set Edge Function secrets

```bash
supabase secrets set VOYAGE_AI_KEY=<your-voyage-key>
```

## 2. Deploy the Edge Function

```bash
supabase functions deploy embed-note --no-verify-jwt=false
```

Capture the deployed URL — it has the form
`https://<project-ref>.functions.supabase.co/embed-note`.

## 3. Provision pg_cron secrets via Supabase Vault

Supabase's SQL editor role lacks `ALTER DATABASE` privilege, so we use the
Vault extension (encrypted secret storage) instead of database parameters.
Open the SQL editor and run:

```sql
select vault.create_secret(
  'https://<project-ref>.functions.supabase.co/embed-note',
  'embed_fn_url'
);

select vault.create_secret(
  '<service-role-jwt>',
  'service_role_key'
);
```

These are read by `cron.schedule('lamplight_embed_sweep', …)` from
`vault.decrypted_secrets` at run time. Until both exist, the sweep is a no-op.

**To rotate the service role key later:** update the existing secret rather
than re-creating it, so the cron job's reference keeps resolving:

```sql
update vault.secrets set secret = '<new-jwt>' where name = 'service_role_key';
```

## 4. Run BSB ingest

```bash
SUPABASE_URL=<...> SUPABASE_SERVICE_ROLE_KEY=<...> VOYAGE_AI_KEY=<...> \
  npx tsx scripts/ingest-bsb.ts
```

Expected: ~32K rows in `bible_passages` + matching rows in `lamplight_embeddings`.
Re-running is a no-op.

## 5. Run note backfill

```bash
SUPABASE_URL=<...> SUPABASE_SERVICE_ROLE_KEY=<...> \
  npx tsx scripts/backfill-note-embeddings.ts
```

The script enqueues `embedding_refresh` jobs; `pg_cron` drains them at 1/min,
or invoke the function directly with `{"sweep":true}` to drain immediately.

## 6. Provision the Waymarks reflection-sweep secret (after migration 046)

Migration 046's hourly `lamplight_reflection_sweep` cron job needs its own vault
secret pointing at `lamplight-generate` (NOT `embed_fn_url` — that secret points
at the `embed-note` function and would 400 if reused here). Provision it the
same way as step 3 above:

```bash
supabase functions deploy lamplight-generate --no-verify-jwt=false
```

Capture the deployed URL — it has the form
`https://<project-ref>.functions.supabase.co/lamplight-generate`. Then in the
SQL editor:

```sql
select vault.create_secret(
  'https://<project-ref>.functions.supabase.co/lamplight-generate',
  'lamplight_generate_fn_url'
);
```

`service_role_key` is shared with the embedding sweep — no need to re-create
it. Until `lamplight_generate_fn_url` exists, `lamplight_reflection_sweep` is
a no-op (same `where config.url is not null and config.key is not null` guard
as migration 011's sweep). Rotate it the same way as `service_role_key` (§3):
`update vault.secrets set secret = '<new-url>' where name = 'lamplight_generate_fn_url';`
