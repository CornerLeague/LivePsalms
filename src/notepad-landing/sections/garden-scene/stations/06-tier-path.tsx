// src/notepad-landing/sections/garden-scene/stations/06-tier-path.tsx
import { useRef } from 'react';
import { copy } from '../../../data/copy';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { useActiveVideoPlayback } from '../../../hooks/use-active-video-playback';

interface Props {
  isActive: boolean;
}

export function StationTierPath({ isActive }: Props) {
  const { eyebrow, h2, body } = copy.section07;
  const videoRef = useRef<HTMLVideoElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useActiveVideoPlayback(videoRef, isActive, prefersReducedMotion);

  return (
    <article
      id="section-07"
      className={`garden-station garden-station--tier-path${isActive ? ' active' : ''}`}
      aria-hidden={isActive ? undefined : 'true'}
    >
      <div className="garden-station-pair">
        <div className="tier-path-video-wrap">
          <video
            ref={videoRef}
            className="tier-path-video"
            poster="/notepad-audio-presence-video-poster.jpg"
            preload="metadata"
            muted
            loop
            playsInline
            aria-label="Recording audio in Live Psalms — capturing a voice note, sermon, or Bible study alongside your written notes."
          >
            <source src="/notepad-audio-presence-video.webm" type="video/webm" />
            <source src="/notepad-audio-presence-video.mp4"  type="video/mp4"  />
          </video>
        </div>
        <div className="garden-station-content garden-station-content--right">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{h2}</h2>
          <p className="body">{body}</p>
        </div>
      </div>
    </article>
  );
}
