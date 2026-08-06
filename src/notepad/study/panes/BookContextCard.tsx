// src/notepad/study/panes/BookContextCard.tsx
// The book apparatus card — author, era, region, genre, setting, summary.
//
// Extracted from ApparatusRail so the rail and the Insights Reference door
// render the SAME component rather than two drifting copies of the same eight
// fields. That shared implementation is the whole answer to the duplication
// the full-width-overlay placement would otherwise create (design §5).
//
// `author_note` is load-bearing: it carries the hedge the data records
// ("traditionally attributed to Moses; authorship debated"). A disputed
// attribution must reach the reader as disputed — never silently resolved.
import type { BookApparatus } from '../useApparatus';

export interface BookContextCardProps {
  ctx: BookApparatus;
}

export function BookContextCard({ ctx }: BookContextCardProps) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, color: 'var(--deep-umber)', margin: '0 0 8px' }}>{ctx.full_name}</h2>
      <dl
        style={{
          fontSize: 12,
          color: 'var(--deep-umber)',
          lineHeight: 1.7,
          letterSpacing: '0.01em',
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div><strong>Author:</strong> {ctx.author}{ctx.author_note ? ` — ${ctx.author_note}` : ''}</div>
        {ctx.date_label && <div><strong>Date:</strong> {ctx.date_label}</div>}
        {ctx.region && <div><strong>Region:</strong> {ctx.region}</div>}
        {ctx.genre && <div><strong>Genre:</strong> {ctx.genre}</div>}
        {ctx.cultural_context && <p style={{ margin: '4px 0 0' }}>{ctx.cultural_context}</p>}
        {ctx.summary && <p style={{ margin: '4px 0 0' }}>{ctx.summary}</p>}
      </dl>
    </section>
  );
}
