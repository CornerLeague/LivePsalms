// src/notepad/components/lamplight/chat/ChatMessage.tsx
import { bookByAbbrev } from '@/notepad/bible/bible-books';
import type { ChatCitation } from '@/notepad/bible/lamplight-chat-client';

export interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  citations: ChatCitation[];
  /** Resolve a note citation's id to its title. Returns undefined if the note is unknown (e.g. deleted). */
  resolveNoteTitle?: (id: string) => string | undefined;
  /** True while the assistant reply is still streaming in. */
  streaming?: boolean;
  /** Pipeline stage currently in progress; only meaningful when streaming=true. */
  stage?: 'notes' | 'scripture' | 'composing' | null;
}

/** Maps the streaming pipeline stage to the same narration strings used in TodaysLampLoading. */
const STAGE_NARRATION: Record<'notes' | 'scripture' | 'composing', string> = {
  notes: 'Reading your recent notes…',
  scripture: 'Searching Scripture…',
  composing: "Today's Lamp is on its way…",
};

/**
 * "jhn 10:11" → "John 10:11"; a note citation resolves to its title (never the
 * raw id), falling back to a generic "Note" when the title can't be resolved.
 */
function humanizeRef(c: ChatCitation, resolveNoteTitle?: (id: string) => string | undefined): string {
  if (c.type === 'verse') {
    const m = c.ref.match(/^([0-9a-z]{3})\s+(.+)$/i);
    if (m) return `${bookByAbbrev(m[1].toLowerCase())?.name ?? m[1]} ${m[2]}`;
    return c.ref;
  }
  return resolveNoteTitle?.(c.ref) ?? 'Note';
}

export function ChatMessage({ role, content, citations, resolveNoteTitle, streaming, stage }: ChatMessageProps) {
  const isUser = role === 'user';
  const showNarration = !isUser && streaming && !content && stage != null;
  const showCaret = !isUser && streaming && !!content;
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className="max-w-[85%] text-[12px] leading-[1.55] p-2.5"
        style={{
          fontFamily: 'Outfit, sans-serif',
          borderRadius: isUser ? '11px 11px 3px 11px' : '11px 11px 11px 3px',
          background: isUser ? '#C49A78' : '#fff',
          color: isUser ? '#fff' : '#4a4136',
          border: isUser ? 'none' : '1px solid #ece2d4',
        }}
      >
        {showNarration ? (
          <span
            style={{ opacity: 0.6, fontStyle: 'italic' }}
            role="status"
            aria-live="polite"
          >
            {STAGE_NARRATION[stage]}
          </span>
        ) : (
          <span>
            {content}
            {showCaret && (
              <span
                aria-hidden="true"
                data-testid="streaming-caret"
                className="inline-block motion-safe:animate-caret-blink"
              >
                {' '}▍
              </span>
            )}
          </span>
        )}
        {!isUser && citations.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {citations.map((c, i) => (
              <span
                key={`${c.type}-${c.ref}-${i}`}
                className="text-[9px] px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(122,155,174,0.14)', color: '#5d7c8b', border: '1px solid rgba(122,155,174,0.3)' }}
              >
                <span aria-hidden="true">↳ </span>
                {humanizeRef(c, resolveNoteTitle)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
