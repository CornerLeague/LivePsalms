// src/notepad/study/insights/PassageDoor.tsx
// A generated Insights door. Door-generic since B3: the headings, the section
// order and the cache scope all come from the door view it is handed, so Door 1
// and Door 2 are one component with two registry entries.
//
// TWO RENDER PATHS, and the difference is the point (design D3):
//   cached   → one public DB read, on screen immediately. No spinner.
//   uncached → nothing until the reader presses "Study this passage", then the
//              sections stream in one at a time.
//
// Every section may be absent, and absence renders NOTHING — no heading, no
// placeholder, no apology. A chapter whose shape the grounding could not
// support simply has three sections instead of four. That is a normal outcome,
// which is why the tool allows an empty field at all.
import { SignInGate } from '@/notepad/components/lamplight/SignInGate';
import { PaywallCard } from '@/notepad/components/lamplight/PaywallCard';
import { usePassageInsight } from './usePassageInsight';
import {
  type PassageInsightInvoke,
  type PassageInsightScope,
} from './passage-insight-stream-client';
import { PASSAGE_DOOR_VIEW, insightPromptRef, type InsightDoorView } from './insight-doors';
import { SectionFooter } from './SectionFooter';

export interface PassageDoorProps {
  scope: PassageInsightScope;
  /** null for a reader who cannot generate. The cache read still runs. */
  invoke: PassageInsightInvoke | null;
  /** Plus/promo. Cached content ignores this entirely — only the action is gated. */
  canGenerate: boolean;
  /** Chooses which blocked affordance a non-entitled reader sees. */
  userId?: string | null;
  /** Which door to render. Defaults to Door 1, matching B2's call sites. */
  door?: InsightDoorView;
  /**
   * Carry a section's seeded prompt into study chat. Omitted where there is no
   * chat to carry it to, and the footers then do not render at all.
   */
  onHandoff?: (prompt: string) => void;
}

export function PassageDoor({
  scope,
  invoke,
  canGenerate,
  userId = null,
  door = PASSAGE_DOOR_VIEW,
  onHandoff,
}: PassageDoorProps) {
  const { sections, loading, streaming, error, generate } = usePassageInsight(
    scope,
    canGenerate ? invoke : null,
    door,
  );

  // Composed from the CURRENT scope on every render, not frozen at mount: the
  // overlay's "Whole chapter" toggle changes `scope` without unmounting, and a
  // stale prompt would ask about a passage the reader has left.
  const promptRef = insightPromptRef(scope);

  /**
   * ⚠️ Signed-out readers get no footer, and that is deliberate.
   *
   * A cached door is public and free, so a signed-out reader reaches this prose
   * — but the chat input they would land in is disabled, and a disabled input
   * with a value shows the value rather than its "Sign in to use Lamplight
   * Study" placeholder. They would see a greyed-out question beside a greyed-out
   * Send and no explanation. That is #120's shape exactly: `hasAccess`
   * short-circuited on the promo and offered a signed-out reader a button that
   * dead-ended. Check who is asking before offering the action.
   *
   * Entitlement is NOT part of this. Study chat runs its own gates, and a
   * signed-in reader without Plus should reach them by asking, not by being
   * quietly denied the question.
   */
  const handoff = userId != null ? onHandoff ?? null : null;

  if (loading) return null;

  // Nothing generated yet. The action is the door.
  if (sections === null) {
    if (!canGenerate || !invoke) {
      // A BLOCKED AFFORDANCE, not silence. The door is listed in the overlay's
      // chooser, so a reader who opens it and finds an empty panel learns
      // nothing about why. Mirrors EtymologyPanel and BibleStudyPane:
      // SignInGate when logged out, PaywallCard otherwise.
      return (
        <div style={{ padding: '16px 0' }}>
          {userId == null ? <SignInGate /> : <PaywallCard />}
        </div>
      );
    }
    return (
      <div style={{ padding: '24px 0' }}>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={streaming}
          style={{
            padding: '10px 18px',
            borderRadius: 8,
            border: '1px solid var(--deep-umber)',
            background: 'transparent',
            color: 'var(--deep-umber)',
            fontSize: 14,
            cursor: streaming ? 'default' : 'pointer',
          }}
        >
          Study this passage
        </button>
        {error && (
          <p style={{ fontSize: 13, color: 'var(--deep-umber)', opacity: 0.75, marginTop: 10 }}>
            That didn’t finish. Try again.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {door.sections.map((section) => {
        const body = sections[section.key] ?? '';
        // The heading belongs to the body. An empty section is not a section.
        if (body.trim().length === 0) return null;
        return (
          <section key={section.key} style={{ marginBottom: 28 }}>
            <h3 style={{ fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7, margin: '0 0 8px' }}>
              {section.label}
            </h3>
            <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--deep-umber)', margin: 0, whiteSpace: 'pre-wrap' }}>
              {body}
            </p>
            {handoff && (
              <SectionFooter prompt={section.seededPrompt(promptRef)} onPress={handoff} />
            )}
          </section>
        );
      })}
    </div>
  );
}
