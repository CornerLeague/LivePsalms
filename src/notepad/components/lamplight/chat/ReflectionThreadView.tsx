// src/notepad/components/lamplight/chat/ReflectionThreadView.tsx
import { ChevronLeft } from 'lucide-react';
import { useThreadMessages } from '@/notepad/bible/useThreadMessages';
import { ChatMessage } from './ChatMessage';

export interface ReflectionThreadViewProps {
  threadId: string;
  onBack: () => void;
}

export function ReflectionThreadView({ threadId, onBack }: ReflectionThreadViewProps) {
  const { messages, loading, error } = useThreadMessages(threadId);

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: 'Outfit, sans-serif', background: 'var(--chat-panel-bg)' }}>
      <div className="flex items-center justify-between px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--pale-stone)' }}>
        <button
          aria-label="Back to history"
          onClick={onBack}
          className="flex items-center gap-1 text-[11px]"
          style={{ color: 'var(--deep-umber)' }}
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Back to history
        </button>
        <span className="text-[9px] tracking-wider" style={{ color: 'var(--silica)' }}>READ-ONLY</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <p className="text-[11px]" style={{ color: 'var(--silica)' }}>Loading reflection…</p>}
        {error && !loading && <p className="text-[11px]" style={{ color: 'var(--error-rose, #b45454)' }}>{error}</p>}
        {!loading && !error && messages.map((m) => (
          <ChatMessage key={m.id} role={m.role} content={m.content} citations={m.citations} />
        ))}
      </div>
    </div>
  );
}
