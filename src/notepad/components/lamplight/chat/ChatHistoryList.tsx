// src/notepad/components/lamplight/chat/ChatHistoryList.tsx
import { ChevronLeft } from 'lucide-react';
import type { ChatThreadSummary } from '@/notepad/bible/useChatThreadList';

export interface ChatHistoryListProps {
  threads: ChatThreadSummary[];
  loading: boolean;
  onSelect: (threadId: string) => void;
  onBack: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export function ChatHistoryList({ threads, loading, onSelect, onBack }: ChatHistoryListProps) {
  return (
    <div className="flex flex-col h-full" style={{ fontFamily: 'Outfit, sans-serif' }}>
      <div className="flex items-center gap-1 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--pale-stone)' }}>
        <button
          aria-label="Back to current reflection"
          onClick={onBack}
          className="flex items-center gap-1 text-[11px]"
          style={{ color: 'var(--deep-umber)' }}
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Back to current
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <p className="text-[11px]" style={{ color: 'var(--silica)' }}>Loading history…</p>}
        {!loading && threads.length === 0 && (
          <p className="text-[11px]" style={{ color: 'var(--silica)' }}>No past reflections for this passage yet.</p>
        )}
        {!loading && threads.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className="w-full text-left p-2.5 rounded-md"
            style={{ background: 'var(--surface-elevated)', border: '1px solid var(--pale-stone)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium truncate" style={{ color: 'var(--deep-umber)' }}>
                {t.title || 'Untitled reflection'}
              </span>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                style={{
                  background: t.archived ? 'rgba(188,179,163,0.25)' : 'rgba(196,154,120,0.18)',
                  color: t.archived ? 'var(--silica)' : 'var(--lamplight-accent)',
                }}
              >
                {t.archived ? 'Past' : 'Current'}
              </span>
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--silica)' }}>{formatDate(t.created_at)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
