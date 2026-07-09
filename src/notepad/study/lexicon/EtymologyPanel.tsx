// src/notepad/study/lexicon/EtymologyPanel.tsx
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, Check, Sparkles } from 'lucide-react';
import { useVerseLexicon } from './useVerseLexicon';
import { normalizeStrongs } from './normalizeStrongs';
import { isFunctionWord, buildEtymologyDeck, type EtymologyDeckCard } from './buildEtymologyDeck';
import { useReviewedEtymologyEntries } from './useReviewedEtymologyEntries';
import { useEtymologyVerseInsight } from './useEtymologyVerseInsight';
import { useLamplightEntitlement } from '@/notepad/hooks/useLamplightEntitlement';
import { useIsMobile } from '@/hooks/use-mobile';
import { SignInGate } from '@/notepad/components/lamplight/SignInGate';
import { PaywallCard } from '@/notepad/components/lamplight/PaywallCard';
import type { LamplightAdapter } from '../../storage/lamplight-adapter';

const label: React.CSSProperties = { fontSize: 12, letterSpacing: '0.12em', color: 'var(--silica)' };
const verified: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--verified-teal, #2C7A6B)' };

export interface EtymologyPanelProps {
  verseId: string | null;
  reference: string | null;
  userId: string | null;
  adapter: LamplightAdapter | null;
}

export function EtymologyPanel({ verseId, reference, userId, adapter }: EtymologyPanelProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const { words } = useVerseLexicon(verseId);

  const lexicalKeys = useMemo(
    () => [...new Set(
      words.filter((w) => !isFunctionWord(w.morph) && w.strongs)
        .map((w) => normalizeStrongs(w.strongs as string)).filter(Boolean),
    )],
    [words],
  );
  const { entries, loading } = useReviewedEtymologyEntries(lexicalKeys);
  const { cards, firstStarredIndex } = useMemo(() => buildEtymologyDeck(words, entries), [words, entries]);

  // Reset to the first starred card when the verse changes, or once the deck's
  // starred card is known after entries finish loading (spec §5). Computed
  // during render (React's documented "adjusting state when a prop changes"
  // pattern) instead of in a useEffect, so it doesn't cascade an extra render.
  const [currentIndex, setCurrentIndex] = useState(firstStarredIndex);
  const resetKey = `${verseId ?? ''}:${firstStarredIndex}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setCurrentIndex(firstStarredIndex);
  }

  const hasLexical = cards.some((c) => c.kind === 'lexical');
  if (verseId == null) return null;
  if (!loading && !hasLexical) return null; // panel-activation gate (spec §7)

  const goNext = () => setCurrentIndex((i) => Math.min(i + 1, cards.length - 1)); // RTL: leftward
  const goPrev = () => setCurrentIndex((i) => Math.max(i - 1, 0));
  const current = cards[currentIndex];

  return (
    <section
      style={{ marginBottom: 24, borderBottom: '1px solid var(--pale-stone)', paddingBottom: 16 }}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') goNext(); if (e.key === 'ArrowRight') goPrev(); }}
      tabIndex={0}
    >
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} />}
        <span style={label}>ETYMOLOGY</span>
        {reference && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--lamplight-accent)', fontWeight: 600 }}>{reference}</span>}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {loading && <div data-testid="etymology-skeleton" style={{ height: 120, background: 'var(--cream, #F4F1EA)', borderRadius: 8 }} />}

          {!loading && current && (
            <>
              {current.kind === 'lexical'
                ? <LexicalCard card={current} verseId={verseId} userId={userId} adapter={adapter} />
                : <FunctionCard card={current} />}

              <DeckStrip cards={cards} currentIndex={currentIndex} onSelect={setCurrentIndex} />

              {isMobile && <p style={{ fontSize: 10, color: 'var(--silica)', margin: '6px 0 0' }}>Swipe the strip to move through the verse.</p>}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                <button type="button" aria-label="next word" onClick={goNext} disabled={currentIndex >= cards.length - 1}
                  style={navBtn}><ChevronLeft className="w-4 h-4" /></button>
                <span style={{ ...label, letterSpacing: 0 }}>word {currentIndex + 1} of {cards.length}</span>
                <button type="button" aria-label="previous word" onClick={goPrev} disabled={currentIndex <= 0}
                  style={navBtn}><ChevronRight className="w-4 h-4" /></button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

const navBtn: React.CSSProperties = { minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream, #F4F1EA)', border: 'none', borderRadius: 8, cursor: 'pointer', color: 'var(--deep-umber)' };

function LexicalCard({ card, verseId, userId, adapter }: { card: Extract<EtymologyDeckCard, { kind: 'lexical' }>; verseId: string; userId: string | null; adapter: LamplightAdapter | null }) {
  const { entry, word } = card;
  const { hasAccess } = useLamplightEntitlement({ adapter, userId: adapter ? userId : null });
  const { insight, generating, error, generate } = useEtymologyVerseInsight(card.strongs, verseId, adapter);
  const canGenerate = hasAccess('inline');

  return (
    <div style={{ borderRadius: 8, background: 'var(--cream, #F4F1EA)', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span dir="rtl" style={{ fontSize: 22, color: 'var(--deep-umber)' }}>{word.original}</span>
        <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--silica)' }}>{word.transliteration}</span>
        <span style={{ fontSize: 12, color: 'var(--deep-umber)' }}>{word.gloss}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--lamplight-accent)', fontWeight: 600 }}>{card.strongs}</span>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={verified}><Check className="w-3 h-3" /> from Strong&apos;s + BDB</div>
        <div style={{ fontSize: 13, color: 'var(--deep-umber)' }}><strong>{entry.root}</strong> — {entry.rootGloss}</div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--lamplight-accent)', fontWeight: 600 }}><Sparkles className="w-3 h-3" /> Lamplight</div>
        <p style={{ fontFamily: 'var(--font-voice, Georgia, serif)', fontSize: 14, lineHeight: 1.6, color: 'var(--deep-umber)', margin: '2px 0 0' }}>{entry.development}</p>
      </div>

      {entry.related.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={verified}><Check className="w-3 h-3" /> related</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '2px 0 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {entry.related.map((r) => (
              <li key={r.strongs} style={{ fontSize: 12, color: 'var(--deep-umber)' }}><span dir="rtl">{r.word}</span> · {r.gloss}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {insight
          ? <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--deep-umber)', margin: 0 }}>{insight.body}</p>
          : canGenerate
            ? (
              <button type="button" onClick={generate} disabled={generating} style={{ ...navBtn, width: '100%', minHeight: 44, fontSize: 13, fontWeight: 600 }}>
                {generating ? 'Lamplight is reflecting…' : 'Ask Lamplight about this verse'}
              </button>
            )
            // Blocked affordance — mirror BibleStudyPane: SignInGate when logged out, else PaywallCard.
            : (userId == null ? <SignInGate /> : <PaywallCard />)}
        {error && <p style={{ fontSize: 11, color: 'var(--silica)', margin: '6px 0 0' }}>Couldn&apos;t reach Lamplight — tap Ask to retry.</p>}
      </div>
    </div>
  );
}

function FunctionCard({ card }: { card: Extract<EtymologyDeckCard, { kind: 'function' }> }) {
  const { word } = card;
  return (
    <div style={{ borderRadius: 8, background: 'var(--cream, #F4F1EA)', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span dir="rtl" style={{ fontSize: 22, color: 'var(--deep-umber)' }}>{word.original}</span>
        <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--silica)' }}>{word.transliteration}</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--silica)', margin: '8px 0 0' }}><strong>Grammar:</strong> {word.gloss} — a function word ({word.morph}); it shapes the sentence rather than carrying its own etymology.</p>
    </div>
  );
}

function DeckStrip({ cards, currentIndex, onSelect }: { cards: EtymologyDeckCard[]; currentIndex: number; onSelect: (i: number) => void }) {
  return (
    <ul dir="rtl" style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', gap: 6, overflowX: 'auto' }}>
      {cards.map((c, i) => {
        const isStarredLexical = c.kind === 'lexical' && c.starred;
        return (
          <li key={c.position}>
            <button type="button" onClick={() => onSelect(i)} aria-current={i === currentIndex}
              style={{
                minWidth: 44, minHeight: 32, borderRadius: 6, cursor: 'pointer', color: 'var(--deep-umber)',
                background: i === currentIndex ? 'var(--pale-stone)' : 'var(--cream, #F4F1EA)',
                border: c.kind === 'function' ? '1px dashed var(--silica)' : '1px solid transparent',
                fontWeight: isStarredLexical ? 700 : 400,
              }}>
              <span dir="rtl">{c.word.original}</span>{isStarredLexical ? ' ★' : ''}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
