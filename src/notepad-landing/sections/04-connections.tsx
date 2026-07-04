import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { copy } from '../data/copy';
import { useIntersectionStage } from '../hooks/use-intersection-stage';

interface ConnectionsProps {
  prm: boolean;
}

export function Connections({ prm }: ConnectionsProps) {
  const ref = useRef<HTMLElement>(null);
  const staged = useIntersectionStage(ref);
  const { eyebrow, h2, body, supporting, detail, cta } = copy.section04;

  return (
    <section
      ref={ref}
      className={`section connections${staged ? ' is-staged' : ''}`}
      aria-labelledby="sec04-h2"
    >
      <div className="connections-content">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="sec04-h2">{h2}</h2>
        <p className="body connections-body">{body}</p>
        <p className="supporting connections-supporting">{supporting}</p>
        <p className="supporting connections-supporting">{detail}</p>

        <div className="connections-media">
          <video
            className="connections-feature-video"
            autoPlay={!prm}
            muted
            loop
            playsInline
            preload="metadata"
            poster="/notepad-connections-video-poster.jpg"
            controls={prm}
            aria-label="A walkthrough of connections in Live Psalms — how your own notes link to one another and to scripture, with a connection card surfacing the thread between a verse or theme you return to over time."
          >
            <source src="/notepad-connections-video.webm" type="video/webm" />
            <source src="/notepad-connections-video.mp4" type="video/mp4" />
          </video>
        </div>

        <div className="connections-actions">
          <Link to="/notebook/notes" className="cta-primary">{cta}</Link>
        </div>
      </div>
    </section>
  );
}
