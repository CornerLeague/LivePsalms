import './waymarks.css';
import type { Marker } from '../../storage/lamplight-artifacts';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2026-05-12' → 'May 12'. Pure, local to the marker path. Guards a missing date
// (partial marker) so it degrades to '' rather than throwing on undefined.split.
function markerDate(iso: string | undefined): string {
  const [, m, d] = (iso ?? '').split('-');
  if (!m || !d) return '';
  return `${MONTHS_SHORT[Number(m) - 1] ?? ''} ${Number(d)}`;
}

export interface MarkerPathProps {
  markers: Marker[];
}

export function MarkerPath({ markers }: MarkerPathProps) {
  // Guard undefined/empty: a partial ready artifact may carry a letter but no
  // markers array, and `undefined.length` would blank the route.
  if (!markers || markers.length === 0) return null;
  return (
    <section className="wm-markers" aria-label="The moments, marked">
      <p className="wm-label wm-markers__head">THE MOMENTS, MARKED</p>
      <ol className="wm-markers__list">
        {markers.map((m, i) => (
          <li key={i} className="wm-marker">
            <span className="wm-marker__date wm-label">
              {markerDate(m.date)}{m.date_end ? ` – ${markerDate(m.date_end)}` : ''}
            </span>
            {m.verse && <span className="wm-marker__verse wm-title">{m.verse}</span>}
            <span className="wm-marker__phrase wm-caption">{m.phrase}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
