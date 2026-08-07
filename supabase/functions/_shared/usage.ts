// Fire-and-forget audit insert. A usage-table outage must never break the
// primary work path (embedding, generation). Errors log; the function resolves.

export interface UsageRow {
  user_id: string;
  // null when no model ran (quota block, context-build throw). A fictional
  // model id would corrupt cost attribution — null is the honest value.
  model: string | null;
  artifact_kind: string;
  tokens_in: number;
  tokens_out: number;
  status: 'ok' | 'error';
  error_code?: string | null;
}

// The per-call usage payload, minus the identity fields (user_id,
// artifact_kind) the lifecycle owns and merges in. Callers supply only the rest.
export type UsageCore = Omit<UsageRow, 'user_id' | 'artifact_kind'>;

// Minimal Supabase client shape required by this helper. Keeping the type
// narrow makes it easy to fake in unit tests and avoids cross-runtime
// (Deno vs Node) type drag from the official client.
// NOTE ON `PromiseLike` BELOW, which reads like a nicety and is not.
//
// supabase-js query builders are THENABLE, not Promises: a PostgrestFilterBuilder
// has `then` but no `catch`, no `finally`, no [Symbol.toStringTag]. Declaring
// these minimal shapes as `Promise<...>` therefore described something the real
// client cannot satisfy — which nothing noticed while the Deno shells (the only
// callers that pass a REAL client; every test passes a fake returning a true
// Promise) were outside the typechecker.
//
// `PromiseLike` is the honest contract: this code only ever awaits the result,
// and await needs nothing more. It accepts both the real builder and the fakes,
// and it widens NOTHING about the query surface — `from`/`select`/`eq` stay as
// narrow as they were, which is the whole point of these types.
export interface UsageSupabaseClient {
  from(table: 'lamplight_usage'): {
    insert(row: UsageRow): PromiseLike<{ error: { message: string } | null }>;
  };
}

export async function recordLamplightUsage(
  supabase: UsageSupabaseClient,
  row: UsageRow,
): Promise<void> {
  try {
    const { error } = await supabase.from('lamplight_usage').insert(row);
    if (error) {
      console.error('[lamplight_usage] insert failed', error.message, { row });
    }
  } catch (e) {
    console.error('[lamplight_usage] insert threw', e, { row });
  }
}
