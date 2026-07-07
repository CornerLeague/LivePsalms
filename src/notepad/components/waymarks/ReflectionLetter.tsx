import './waymarks.css';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

export interface ReflectionLetterProps {
  artifact: ReflectionArtifact;
  /** The user's own note on this month (§17) — rendered as a SEPARATE aside, never replacing the letter. */
  annotation?: string | null;
}

// The letter is prose with blank-line paragraph breaks; split on 2+ newlines.
export function ReflectionLetter({ artifact, annotation }: ReflectionLetterProps) {
  const paragraphs = artifact.letter.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const hasAnnotation = typeof annotation === 'string' && annotation.trim().length > 0;
  return (
    <article className="wm-letter">
      <h1 className="wm-title wm-letter__title">{artifact.title}</h1>
      {paragraphs.map((p, i) => (
        <p key={i} className="wm-letter__body">{p}</p>
      ))}
      {hasAnnotation && (
        <aside className="wm-annotation" aria-label="Your words">
          <p className="wm-label">Your words</p>
          <p className="wm-annotation__text wm-caption">{annotation}</p>
        </aside>
      )}
    </article>
  );
}
