import './waymarks.css';
import { Stone } from './Stone';

// §13.4 — an invitation, NOT a paywall: an evocative paragraph, a ghosted (labeled) example path,
// and ONE quiet affordance. No counts, no feature grid, no "unlock N months".
const EXAMPLE_MONTHS = ['January', 'February', 'March'];

export function WaymarksLockedPreview() {
  return (
    <div className="wm-root">
      <div className="wm-locked">
        <p className="wm-label">Waymarks</p>
        <h1 className="wm-title wm-locked__title">A path made of the months you’ve kept</h1>
        <p className="wm-locked__body wm-caption">
          Each month you write, Lamplight sets down a stone — a quiet letter about where you walked
          and the verses that walked with you. Over time they become a path you can turn around and see.
        </p>
        <ul className="wm-locked__example" aria-hidden="true">
          {EXAMPLE_MONTHS.map((m, i) => (
            <li key={m} className="wm-locked__node" style={{ opacity: 0.35 }}>
              <Stone label={`${m} — example`} rotation={(i - 1) * 4} fillVar={`--wm-stone-${(i % 3) + 1}`} />
              <span className="wm-caption">{m}</span>
            </li>
          ))}
        </ul>
        {/* Upgrade affordance — confirm the app's Plus-upgrade route during execution (seam). */}
        <a className="wm-locked__cta wm-label" href="/profile">See your own months marked</a>
      </div>
    </div>
  );
}
