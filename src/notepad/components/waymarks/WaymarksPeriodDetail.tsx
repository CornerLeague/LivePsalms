import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Check, Bookmark, EyeOff } from 'lucide-react';
import './waymarks.css';
import { ReflectionLetter } from './ReflectionLetter';
import { MarkerPath } from './MarkerPath';
import { useReflections } from '../../hooks/useReflections';
import type { LamplightAdapter, ReflectionRecord } from '../../storage/lamplight-adapter';

export interface WaymarksPeriodDetailProps {
  adapter: LamplightAdapter;
  userId: string;
  /**
   * The detail BODY never gates on this (decision 1) — a downgraded reader can still
   * open an already-generated stone. It gates ONLY autoGenerate (final-review rider):
   * without this, a downgraded user following a stale deep link to a month that was
   * never generated would fire a guaranteed-403 generate call and see misleading retry
   * copy ("Try again") for a request that can never succeed while access is off.
   */
  canAccess: boolean;
  /** Save-to-notes seam: the connector inserts the letter as a note (Notepad's collection.createNote). */
  onSaveToNotes?: (record: ReflectionRecord) => void | Promise<void>;
}

// "Opened" has no DB column (decision 4) — persist it in localStorage so the newest-stone
// shimmer cue on the list (WaymarksReflections) clears once the letter has been viewed.
const openedKey = (periodKey: string) => `wm-opened:${periodKey}`;
function markOpened(periodKey: string): void {
  try { localStorage.setItem(openedKey(periodKey), '1'); } catch { /* private mode — cue just persists */ }
}

export function WaymarksPeriodDetail({ adapter, userId, canAccess, onSaveToNotes }: WaymarksPeriodDetailProps) {
  const { periodKey = '' } = useParams();
  const { state, retry } = useReflections({ adapter, userId, periodKey, autoGenerate: canAccess });
  const [annotation, setAnnotation] = useState<string | null>(null);

  // Load the satellite annotation state (§17 aside) once we know the period.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await adapter.getReflectionState(userId, 'reflection_recap', periodKey);
      if (alive) setAnnotation(s?.annotation ?? null); // getReflectionState → ReflectionState | null
    })();
    return () => { alive = false; };
  }, [adapter, userId, periodKey]);

  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [savedToNotes, setSavedToNotes] = useState(false);

  // Keep the textarea in sync with the loaded annotation; reflect the persisted saved flag.
  // Both are synchronous derived-state resets driven by async-loaded values (annotation
  // from the satellite-state effect above, state.record from useReflections) — there's no
  // external system to subscribe to here, just re-deriving local UI state when its source changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(annotation ?? '');
  }, [annotation]);
  useEffect(() => {
    if (state.phase === 'ready') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSavedToNotes(state.record.savedToNotes);
    }
  }, [state]);
  // Clear the newest-stone shimmer cue once the letter is actually viewed.
  useEffect(() => {
    if (state.phase === 'ready') markOpened(periodKey);
  }, [state.phase, periodKey]);

  const saveAnnotation = async () => {
    await adapter.setReflectionAnnotation(userId, 'reflection_recap', periodKey, draft.trim() || null);
    const s = await adapter.getReflectionState(userId, 'reflection_recap', periodKey);
    setAnnotation(s?.annotation ?? null); // null-guard: getReflectionState → ReflectionState | null
  };
  const hide = async () => {
    try {
      await adapter.setReflectionHidden(userId, 'reflection_recap', periodKey, true);
    } catch {
      return; // hide write failed — stay on the letter so the button stays live for retry
    }
    navigate('..'); // relative — resolves to the reflections index under whichever mount rendered this route
  };
  const saveToNotes = async () => {
    if (state.phase !== 'ready') return; // narrows state.record for TS
    // Note insert BEFORE the flag write — saved_to_notes=true must imply the note
    // exists. Flag-first bricks the button on the next visit when the insert fails
    // (flag persisted, no note, retry disabled). The residual failure the other way
    // (note created, flag write fails → a retry can duplicate the note) is visible
    // and deletable, so it's the side we accept.
    try {
      await onSaveToNotes?.(state.record);
    } catch {
      return; // insert failed — leave the flag unset so the button stays live for retry
    }
    try {
      await adapter.setReflectionSavedToNotes(userId, periodKey, true);
    } catch {
      return; // flag write failed — keep the button live; the connector's dedupe keeps the retry from duplicating the note
    }
    setSavedToNotes(true);
  };

  const back = (
    <Link to=".." className="wm-back wm-label">← Waymarks</Link>
  );

  // Non-ready phases (§13.6 copy). retrieving/generating/refining stream a quiet caption.
  if (state.phase !== 'ready') {
    let body: ReactNode;
    if (state.phase === 'empty') {
      body = <p className="wm-caption">Nothing was written here.</p>;
    } else if (state.phase === 'unavailable' || state.phase === 'error') {
      body = (
        <div>
          <p className="wm-caption">This one isn't ready yet. Try again.</p>
          <div className="wm-detail__actions">
            <button type="button" className="wm-detail__retry" onClick={retry}>Try again</button>
          </div>
        </div>
      );
    } else {
      const msg = state.phase === 'retrieving' ? 'Turning to this month…' : 'Composing what this month held…';
      body = <p className="wm-caption" aria-live="polite">{msg}</p>;
    }
    return (
      <div className="wm-root wm-detail">
        {back}
        <div className="wm-detail__status">{body}</div>
      </div>
    );
  }

  const { artifact } = state.record;

  return (
    <div className="wm-root wm-detail">
      {back}
      <div className="wm-fade">
        <ReflectionLetter artifact={artifact} annotation={annotation} />
        <MarkerPath markers={artifact.markers} />

        <div className="wm-annotate">
          <span className="wm-annotate__prompt wm-caption">＋ Add your words.</span>
          <textarea
            className="wm-annotate__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            aria-label="Your words"
            placeholder="A line for yourself, kept beside the letter."
          />
          <div className="wm-annotate__actions">
            <button
              type="button"
              className="wm-circle wm-circle--primary wm-annotate__save"
              aria-label="Save your words"
              onClick={() => void saveAnnotation()}
            >
              <span className="wm-circle__disc" aria-hidden="true"><Check size={18} strokeWidth={1.5} /></span>
              <span className="wm-circle__label" aria-hidden="true">Save your words</span>
            </button>
          </div>
        </div>
        <footer className="wm-detail__footer wm-detail__actions">
          <button
            type="button"
            className="wm-circle wm-detail__save"
            aria-label={savedToNotes ? 'Saved to notes' : 'Save to notes'}
            onClick={() => void saveToNotes()}
            disabled={savedToNotes}
          >
            <span className="wm-circle__disc" aria-hidden="true">
              {savedToNotes ? <Check size={18} strokeWidth={1.5} /> : <Bookmark size={18} strokeWidth={1.5} />}
            </span>
            <span className="wm-circle__label" aria-hidden="true">{savedToNotes ? 'Saved to notes' : 'Save to notes'}</span>
          </button>
          <button
            type="button"
            className="wm-circle wm-detail__hide"
            aria-label="Hide this stone"
            onClick={() => void hide()}
          >
            <span className="wm-circle__disc" aria-hidden="true"><EyeOff size={18} strokeWidth={1.5} /></span>
            <span className="wm-circle__label" aria-hidden="true">Hide this stone</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
