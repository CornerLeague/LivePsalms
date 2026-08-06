// src/notepad/study/insights/CrossReferenceList.tsx
// Cross-references that open where they sit.
//
// Tapping a reference does not navigate and does not hand off to chat — it
// expands in place to the target passage inside its own immediate context, the
// target book's footing, and the church's voices on that ref. All of it class
// A + B: free, instant, quoted.
//
// What is deliberately ABSENT is any generated account of *why* the two
// passages belong together. That needs the Connections Engine's contract
// (Greidanus roads, Hays confidence tiers, the Beale typology gate); without
// it, connection-making drifts into allegory. The reader is shown both
// passages and draws the line. CrossReferenceList.test.tsx guards this.
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { CrossRefView } from '../useApparatus';
import { formatCrossRefLabel } from '../apparatus-queries';
import type { BibleTranslation } from '@/notepad/bible/translations';
import { useCrossRefDetail, type CrossRefTarget } from './useCrossRefDetail';
import { LibraryVoices } from './LibraryVoices';

export interface CrossReferenceListProps {
  crossRefs: CrossRefView[];
  translation: BibleTranslation;
  /** Identity of the passage on screen, e.g. "psa.27". Changing it collapses every row. */
  passageKey: string;
}

const rowKey = (x: CrossRefView) => `${x.to_book}.${x.to_chapter}.${x.to_verse_start}-${x.to_verse_end}`;

export function CrossReferenceList({ crossRefs, translation, passageKey }: CrossReferenceListProps) {
  // Expansion state carries the passage it belongs to, so moving to a new
  // chapter collapses everything without an effect (and so without a
  // synchronous setState in one).
  const [opened, setOpened] = useState<{ passageKey: string; ids: ReadonlySet<string> }>(
    () => ({ passageKey, ids: new Set() }),
  );
  const openIds = opened.passageKey === passageKey ? opened.ids : EMPTY_IDS;

  if (crossRefs.length === 0) return null;

  const toggle = (id: string) => {
    const next = new Set(openIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpened({ passageKey, ids: next });
  };

  return (
    <section>
      <h3 style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--silica)', margin: '0 0 8px' }}>
        CROSS-REFERENCES
      </h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {crossRefs.map((x) => {
          const id = rowKey(x);
          const open = openIds.has(id);
          const target: CrossRefTarget = {
            book: x.to_book, chapter: x.to_chapter,
            verseStart: x.to_verse_start, verseEnd: x.to_verse_end,
          };
          return (
            <li key={id} style={{ marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-expanded={open}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 6, width: '100%',
                  textAlign: 'left', padding: 0, border: 'none', background: 'transparent',
                  cursor: 'pointer', fontFamily: 'Outfit, sans-serif', fontSize: 12, lineHeight: 1.6,
                }}
              >
                <ChevronRight
                  className="w-3.5 h-3.5"
                  style={{
                    flexShrink: 0, marginTop: 3, color: 'var(--lamplight-accent)',
                    transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease',
                  }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ color: 'var(--lamplight-accent)', fontWeight: 600 }}>{formatCrossRefLabel(x)}</span>
                  {x.crossesTestament && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--lamplight-accent)' }}>OT ↔ NT</span>
                  )}
                  {x.text && <span style={{ display: 'block', color: 'var(--deep-umber)', marginTop: 2 }}>{x.text}</span>}
                </span>
              </button>

              {open && <CrossRefExpansion target={target} translation={translation} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

// Its own component so the detail hook mounts only for rows the reader opened —
// a chapter's cross-references would otherwise fire three queries each on open.
function CrossRefExpansion({ target, translation }: { target: CrossRefTarget; translation: BibleTranslation }) {
  const { detail, loading } = useCrossRefDetail(target, translation);

  if (loading && !detail) {
    return (
      <div style={{ padding: '8px 0 0 20px', fontSize: 11, color: 'var(--silica)' }}>Opening…</div>
    );
  }
  if (!detail) return null;

  return (
    <div
      data-testid="crossref-expansion"
      style={{
        marginTop: 8, marginLeft: 20, paddingLeft: 10,
        borderLeft: '2px solid var(--pale-stone)',
      }}
    >
      {detail.verses.length > 0 && (
        <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--deep-umber)', marginBottom: 10 }}>
          {detail.verses.map((v) => (
            <p key={v.verse} style={{ margin: '0 0 4px', opacity: v.isTarget ? 1 : 0.6 }}>
              <span style={{ fontSize: 10, color: 'var(--silica)', marginRight: 4 }}>{v.verse}</span>
              {v.text}
            </p>
          ))}
        </div>
      )}

      {detail.book && (
        <p style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--silica)', margin: '0 0 10px' }}>
          {[
            detail.book.full_name,
            detail.book.genre,
            detail.book.date_label,
            detail.book.author_note ? `${detail.book.author} — ${detail.book.author_note}` : detail.book.author,
          ].filter(Boolean).join(' · ')}
        </p>
      )}

      <LibraryVoices voices={detail.voices} loading={false} />
    </div>
  );
}
