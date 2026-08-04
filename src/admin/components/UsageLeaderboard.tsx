import type { AdminUsageRow } from '@/notepad/storage/lamplight-adapter';
import { estCostCents, formatCents } from '../lamplight-cost';

export interface UsageLeaderboardProps {
  rows: AdminUsageRow[];
  loading: boolean;
  windowDays: number;
  onWindowChange: (d: number) => void;
}

const WINDOW_OPTIONS = [
  { label: '24h', value: 1 },
  { label: '7d',  value: 7 },
  { label: '30d', value: 30 },
];

function approxCostCents(row: AdminUsageRow): number {
  // Aggregate rows don't carry model — assume gpt-5.6-luna for ballpark display.
  // Replace with per-model breakdown when the RPC ships that shape.
  return estCostCents('gpt-5.6-luna', row.tokensIn, row.tokensOut);
}

export function UsageLeaderboard({ rows, loading, windowDays, onWindowChange }: UsageLeaderboardProps) {
  return (
    <div className="rounded-md border" data-testid="usage-leaderboard">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--deep-umber)' }}>Token spend</span>
        <label className="ml-auto text-xs flex items-center gap-1">
          Window
          <select value={windowDays} onChange={(e) => onWindowChange(Number(e.target.value))} className="border rounded px-2 py-1">
            {WINDOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      {loading ? (
        <div className="px-4 py-6 text-xs" style={{ color: 'var(--deep-umber)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-xs" style={{ color: 'var(--deep-umber)' }}>
          No usage recorded in the selected window.
        </div>
      ) : (
        <ul className="divide-y">
          {rows.map(r => (
            <li key={r.userId} className="px-4 py-2 text-xs flex items-center gap-3">
              <span className="font-medium">{r.email ?? r.userId.slice(0, 8)}</span>
              <span style={{ color: 'var(--silica)' }}>{r.tokensIn.toLocaleString()} in · {r.tokensOut.toLocaleString()} out</span>
              <span style={{ color: 'var(--silica)' }}>~ {formatCents(approxCostCents(r))}</span>
              <span className="ml-auto" style={{ color: 'var(--silica)' }}>{r.calls} calls{r.errors > 0 ? ` · ${r.errors} err` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
