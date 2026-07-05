import { useRef } from 'react';
import { copy } from '../data/copy';
import { useIntersectionStage } from '../hooks/use-intersection-stage';

export function TierPath() {
  const ref = useRef<HTMLElement>(null);
  const staged = useIntersectionStage(ref);
  const { eyebrow, h2, body } = copy.section07;

  return (
    <section
      ref={ref}
      className={`section tier-path${staged ? ' is-staged' : ''}`}
      aria-labelledby="sec07-h2"
    >
      <div className="tier-path-content">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="sec07-h2">{h2}</h2>
        <p className="body">{body}</p>
      </div>
    </section>
  );
}
