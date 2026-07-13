// src/notepad/study/memorize/MemorizePanel.tsx
// Memorize home: grouped saved cards with mastery bars + entry into a quiz session.
// Verses are snapshotted (text + translation) so a quiz is stable across
// translation changes. Guests persist to localStorage; signed-in users to Supabase.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Play, X } from 'lucide-react';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
import { useBiblePassages } from '@/notepad/bible/useBiblePassages';
import { useMemorizeCards } from './useMemorizeCards';
import { QuizSession } from './QuizSession';
import { formatCardRef, type MemorizeCard } from './memorize-types';
import { applyAttempt } from './mastery';
import { bookByAbbrev } from '@/notepad/bible/bible-books';

export interface MemorizePanelProps {
  book: string;
  chapter: number;
  userId: string | null;
  /** True when the Memorize tab is the visible pane. Used to refetch on activation. */
  active: boolean;
}

interface Group {
  key: string;
  book: string;
  chapter: number;
  cards: MemorizeCard[];
}

function groupCards(cards: MemorizeCard[]): Group[] {
  const map = new Map<string, Group>();
  for (const c of cards) {
    const key = `${c.book}|${c.chapter}`;
    let g = map.get(key);
    if (!g) { g = { key, book: c.book, chapter: c.chapter, cards: [] }; map.set(key, g); }
    g.cards.push(c);
  }
  return [...map.values()];
}

export function MemorizePanel({ book, chapter, active }: MemorizePanelProps) {
  const { translation } = useBiblePrefs();
  const { verses } = useBiblePassages(book, chapter, translation);
  const { cards, addCards, updateAfterAttempt, removeCard, refetch } = useMemorizeCards();
  const [sessionKey, setSessionKey] = useState<string | null>(null);

  // Refetch when this pane becomes active (a card added from the Reader popover by
  // a separate hook instance won't be in our state until we re-read the store).
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) refetch();
    wasActive.current = active;
  }, [active, refetch]);

  const groups = useMemo(() => groupCards(cards), [cards]);
  const sessionCards = useMemo(
    () => (sessionKey ? groups.find((g) => g.key === sessionKey)?.cards ?? [] : []),
    [sessionKey, groups],
  );

  const addCurrentPassage = () => {
    if (verses.length === 0) return;
    void addCards(verses.map((v) => ({ book, chapter, verse: v.verse, translation, text: v.text })));
  };

  const commit = (results: Array<{ id: string; attemptScore: number }>) => {
    const now = new Date().toISOString();
    for (const r of results) {
      const card = cards.find((c) => c.id === r.id);
      if (card) void updateAfterAttempt(r.id, applyAttempt(card, r.attemptScore, now));
    }
  };

  const inSession = sessionKey != null && sessionCards.length > 0;
  const passageLabel = (g: Group) => `${bookByAbbrev(g.book)?.name ?? g.book} ${g.chapter}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Outfit, sans-serif' }}>
      {/* Quiz session overlays the home view but stays mounted (display toggle). */}
      <div style={{ display: inSession ? 'block' : 'none', height: '100%' }}>
        {inSession && (
          <QuizSession
            key={sessionKey}
            cards={sessionCards}
            onCommit={commit}
            onExit={() => setSessionKey(null)}
          />
        )}
      </div>

      <div style={{ display: inSession ? 'none' : 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderBottom: '1px solid var(--pale-stone)' }}>
          <span style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--silica)' }}>Memorize</span>
          <button type="button" onClick={addCurrentPassage} style={addBtn}>
            <Plus className="w-3.5 h-3.5" /> Add current passage
          </button>
        </div>

        <div style={{ flex: '1 1 0%', minHeight: 0, overflow: 'auto', padding: 12 }}>
          {cards.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--silica)', padding: '32px 16px', fontSize: 13 }}>
              No verses yet. Tap <strong>Add current passage</strong> to start memorizing {bookByAbbrev(book)?.name ?? book} {chapter}.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--deep-umber)' }}>{passageLabel(g)}</span>
                  <button type="button" onClick={() => setSessionKey(g.key)} style={practiceBtn}>
                    <Play className="w-3 h-3" /> Practice
                  </button>
                </div>
                {g.cards.map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--deep-umber)' }}>{formatCardRef(c)}</div>
                      <div style={{ fontSize: 11, color: 'var(--silica)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.text}</div>
                      <div aria-label={`Mastery ${c.mastery}%`} style={{ height: 4, borderRadius: 2, background: 'var(--pale-stone)', marginTop: 4 }}>
                        <div style={{ width: `${c.mastery}%`, height: '100%', borderRadius: 2, background: 'var(--lamplight-accent)' }} />
                      </div>
                    </div>
                    <button type="button" aria-label={`Remove ${formatCardRef(c)}`} onClick={() => void removeCard(c.id)} style={iconBtn}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const addBtn: React.CSSProperties = {
  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '7px 12px',
  borderRadius: 6, border: 'none', background: 'var(--lamplight-accent)', color: '#fff',
  cursor: 'pointer', fontSize: 12, fontWeight: 500, minHeight: 34,
};
const practiceBtn: React.CSSProperties = {
  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
  borderRadius: 6, border: '1px solid var(--pale-stone)', background: 'transparent',
  color: 'var(--deep-umber)', cursor: 'pointer', fontSize: 11, minHeight: 30,
};
const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
  border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--silica)', borderRadius: 6,
};
