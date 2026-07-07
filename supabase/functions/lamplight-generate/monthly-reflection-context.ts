// Builds the MonthlyReflectionContext for a given (user, period): local month bounds,
// the month's notes bucketed by LOCAL day, the candidate pool (Task 4), and the derived
// allowlists the pipeline's validators need. Returns null for an empty month so the caller
// short-circuits to no_notes. All the vitest-testable logic lives here because index.ts
// (Deno serve) cannot be imported by the node test runner.

import { buildReflectionCandidates, type EdgeSupabase } from './reflection-candidates.ts';
import type { MonthNote, MonthlyReflectionContext } from './prompts/monthly-reflection.ts';
import { extractTextFromNoteContent } from '../_shared/tiptap-text.ts';

export function isValidPeriodKey(s: string): boolean {
  return /^\d{4}-\d{2}$/.test(s);
}

// Offset (ms) between the given IANA zone and UTC at the given instant.
function tzOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(at)) if (p.type !== 'literal') map[p.type] = Number(p.value);
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUtc - at.getTime();
}

// The UTC instant of local wall-midnight on (year, month0, day) in timeZone.
// Single-correction; exact except inside the ~1h DST transition window (acceptable — bounds
// are month-edge, and note bucketing uses makeToLocalDay independently).
function localMidnightUtc(year: number, month0: number, day: number, timeZone: string | null): Date {
  const guess = new Date(Date.UTC(year, month0, day, 0, 0, 0));
  if (!timeZone || timeZone === 'UTC') return guess;
  return new Date(guess.getTime() - tzOffsetMs(guess, timeZone));
}

export function localMonthBoundsUtc(
  periodKey: string,
  timeZone: string | null,
): { startUtc: string; endUtc: string; monthStart: string; monthEnd: string } {
  const [y, m] = periodKey.split('-').map(Number);
  const startUtc = localMidnightUtc(y, m - 1, 1, timeZone);
  const endUtc = localMidnightUtc(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, timeZone);
  const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    startUtc: startUtc.toISOString(),
    endUtc: endUtc.toISOString(),
    monthStart: `${periodKey}-01`,
    monthEnd: `${periodKey}-${String(lastDayNum).padStart(2, '0')}`,
  };
}

// Maps an ISO timestamp to the reader's local calendar day ('YYYY-MM-DD').
export function makeToLocalDay(timeZone: string | null): (iso: string) => string {
  if (!timeZone || timeZone === 'UTC') return (iso) => iso.slice(0, 10);
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (iso) => dtf.format(new Date(iso));
}

// RECONCILIATION POINT (resolved): the daily note-loader (index.ts's noteContextDeps.
// fetchRecentNotes, feeding _shared/note-context.ts's retrieveNoteContext) extracts note
// text via _shared/tiptap-text.ts's extractTextFromNoteContent — JSON.parse the TipTap doc
// and walk it, falling back to the raw string on parse failure. Reused verbatim here instead
// of a bespoke walker so both pipelines treat note content identically.

// RECONCILIATION POINT (resolved): the `notes` table shape. The daily loader selects
// `id, title, content, updated_at` and orders/limits by recency (no time-window filter).
// This use case instead needs a month WINDOW, so it filters on `created_at` — the column
// every other candidate-pool query in reflection-candidates.ts already filters the month on
// (gte/lt created_at) — matching the brief's own grounding (`notes(id, user_id, content,
// created_at)`). Kept injectable (deps.loadMonthNotes) so tests never touch the DB and so
// any future reconciliation is a one-line swap.
async function loadMonthNotes(
  supabase: EdgeSupabase,
  args: { userId: string; startUtc: string; endUtc: string },
  toLocalDay: (iso: string) => string,
): Promise<MonthNote[]> {
  const { data } = await supabase
    .from('notes')
    .select('id, content, created_at')
    .eq('user_id', args.userId)
    .gte('created_at', args.startUtc)
    .lt('created_at', args.endUtc)
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as Array<{ id: string; content: unknown; created_at: string }>;
  return rows
    .map((r) => ({ id: r.id, day: toLocalDay(r.created_at), text: extractTextFromNoteContent(r.content as string) }))
    .filter((n) => n.text.trim().length > 0);
}

function formatPeriodLabel(periodKey: string, timeZone: string | null): string {
  const [y, m] = periodKey.split('-').map(Number);
  const mid = new Date(Date.UTC(y, m - 1, 15));
  return new Intl.DateTimeFormat('en-US', { timeZone: timeZone ?? 'UTC', month: 'long', year: 'numeric' }).format(mid);
}

export interface BuildMonthlyReflectionContextDeps {
  loadMonthNotes?: (
    supabase: EdgeSupabase,
    args: { userId: string; startUtc: string; endUtc: string },
    toLocalDay: (iso: string) => string,
  ) => Promise<MonthNote[]>;
  buildCandidates?: typeof buildReflectionCandidates;
}

export async function buildMonthlyReflectionContext(
  supabase: EdgeSupabase,
  args: { userId: string; periodKey: string; timezone: string | null; embed?: (text: string) => Promise<number[]> },
  deps: BuildMonthlyReflectionContextDeps = {},
): Promise<MonthlyReflectionContext | null> {
  const { userId, periodKey, timezone } = args;
  const { startUtc, endUtc, monthStart, monthEnd } = localMonthBoundsUtc(periodKey, timezone);
  const toLocalDay = makeToLocalDay(timezone);

  const load = deps.loadMonthNotes ?? loadMonthNotes;
  const notes = await load(supabase, { userId, startUtc, endUtc }, toLocalDay);
  if (notes.length === 0) return null; // graceful floor → no_notes

  // embed is only invoked by buildReflectionCandidates for the 'semantic' provenance
  // (§reflection-candidates.ts). Real callers (index.ts) pass Voyage's embedQuery; this
  // guard only fires if that wiring is ever dropped, so it fails loudly instead of silently
  // skipping semantic candidates.
  const embed = args.embed ?? (() => {
    throw new Error('buildMonthlyReflectionContext: no embed fn supplied for semantic candidates');
  });

  const buildCandidates = deps.buildCandidates ?? buildReflectionCandidates;
  const { candidates } = await buildCandidates({
    supabase,
    userId,
    notes,
    monthStartUtc: startUtc,
    monthEndUtc: endUtc,
    embed,
    toLocalDay,
  });

  return {
    periodKey,
    periodLabel: formatPeriodLabel(periodKey, timezone),
    monthStart,
    monthEnd,
    notes,
    candidates,
    allowedVerseRefs: new Set(candidates.map((c) => c.ref)),
    allowedNoteDays: new Set(notes.map((n) => n.day)),
  };
}
