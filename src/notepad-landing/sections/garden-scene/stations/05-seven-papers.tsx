// src/notepad-landing/sections/garden-scene/stations/05-seven-papers.tsx
import { useRef } from 'react';
import { copy } from '../../../data/copy';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { useActiveVideoPlayback } from '../../../hooks/use-active-video-playback';

interface Props { isActive: boolean }

export function StationSevenPapers({ isActive }: Props) {
  const { eyebrow, h2, body } = copy.section06;
  const videoRef = useRef<HTMLVideoElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useActiveVideoPlayback(videoRef, isActive, prefersReducedMotion);

  return (
    <article
      id="section-06"
      className={`garden-station garden-station--seven-papers${isActive ? ' active' : ''}`}
      aria-hidden={isActive ? undefined : 'true'}
    >
      <div className="garden-station-pair">
        <div className="garden-station-content garden-station-content--left">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{h2}</h2>
          <p className="body">{body}</p>
        </div>
        <div className="seven-papers-video-wrap">
          <video
            ref={videoRef}
            className="seven-papers-video"
            poster="/notepad-highlight-deco-feature-poster.jpg"
            preload="metadata"
            muted
            loop
            playsInline
            aria-label="The Notepad's spiritual canvas — textured ink highlights and hand-drawn marks placed directly on a note."
          >
            <source src="/notepad-highlight-deco-feature.webm" type="video/webm" />
            <source src="/notepad-highlight-deco-feature.mp4"  type="video/mp4"  />
          </video>
        </div>
      </div>
    </article>
  );
}
