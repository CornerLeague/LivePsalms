// src/notepad-landing/sections/garden-scene/stations/04-scripture-margin.tsx
import { useRef } from 'react';
import { copy } from '../../../data/copy';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { useActiveVideoPlayback } from '../../../hooks/use-active-video-playback';

interface Props { isActive: boolean }

export function StationScriptureMargin({ isActive }: Props) {
  const { eyebrow, h2, body } = copy.section05;
  const videoRef = useRef<HTMLVideoElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useActiveVideoPlayback(videoRef, isActive, prefersReducedMotion);

  return (
    <article
      id="section-05"
      className={`garden-station garden-station--scripture-margin${isActive ? ' active' : ''}`}
      aria-hidden={isActive ? undefined : 'true'}
    >
      <div className="garden-station-pair">
        <div className="garden-station-content garden-station-content--left">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{h2}</h2>
          <p className="body">{body}</p>
        </div>
        <div className="scripture-margin-video-wrap">
          <video
            ref={videoRef}
            className="scripture-margin-video"
            poster="/notepad-bible-study-video-poster.jpg"
            preload="metadata"
            muted
            loop
            playsInline
            aria-label="Lamplight, the biblical AI in Live Psalms — asking Lamplight Study about a passage while reading, and Lamplight writing a personal devotion from your own notes."
          >
            <source src="/notepad-bible-study-video.webm" type="video/webm" />
            <source src="/notepad-bible-study-video.mp4"  type="video/mp4"  />
          </video>
        </div>
      </div>
    </article>
  );
}
