import { useRef } from 'react';
import { copy } from '../data/copy';
import { useIntersectionStage } from '../hooks/use-intersection-stage';

interface LivingGraphProps {
  prm: boolean;
}

export function LivingGraph({ prm }: LivingGraphProps) {
  const ref = useRef<HTMLElement>(null);
  const staged = useIntersectionStage(ref);
  const { eyebrow, h2, points } = copy.section03;

  return (
    <section
      ref={ref}
      className={`section living-graph${staged ? ' is-staged' : ''}`}
      aria-labelledby="sec03-h2"
    >
      <div className="living-graph-media">
        <video
          className="living-graph-video"
          autoPlay={!prm}
          muted
          loop
          playsInline
          preload="metadata"
          poster="/notepad-feature-video-poster.jpg"
          controls={prm}
          aria-label="A walkthrough of capturing notes in Live Psalms — typing /verse to drop a passage into a note, /lookup to find a verse by its words, and notes filing themselves."
        >
          <source src="/notepad-feature-video.webm" type="video/webm" />
          <source src="/notepad-feature-video.mp4" type="video/mp4" />
        </video>
        <div className="living-graph-overlay">
          <p className="eyebrow">{eyebrow}</p>
          <h2 id="sec03-h2">{h2}</h2>
          {points.map((point) => (
            <p className="body" key={point}>{point}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
