import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { copy } from '../data/copy';
import { useIntersectionStage } from '../hooks/use-intersection-stage';

interface LamplightProps {
  prm: boolean;
}

export function Lamplight({ prm: _prm }: LamplightProps) {
  const ref = useRef<HTMLElement>(null);
  const staged = useIntersectionStage(ref);
  const { eyebrow, h2, body, supporting, detail, cta } = copy.section04;

  return (
    <section
      ref={ref}
      className={`section lamplight${staged ? ' is-staged' : ''}`}
      aria-labelledby="sec04-h2"
    >
      <div className="lamplight-content">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="sec04-h2">{h2}</h2>
        <p className="body lamplight-body">{body}</p>
        <p className="supporting lamplight-supporting">{supporting}</p>
        <p className="supporting lamplight-supporting">{detail}</p>
        <div className="lamplight-actions">
          <Link to="/notebook/notes" className="cta-primary">{cta}</Link>
        </div>
      </div>
    </section>
  );
}
