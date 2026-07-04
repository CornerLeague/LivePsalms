// src/notepad-landing/sections/garden-scene/stations/01-three-voices.tsx
import { useRef } from 'react';
import { copy } from '../../../data/copy';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { useActiveVideoPlayback } from '../../../hooks/use-active-video-playback';

interface Props { isActive: boolean }

export function StationThreeVoices({ isActive }: Props) {
  const { eyebrow, h2 } = copy.section02;
  const videoRef = useRef<HTMLVideoElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useActiveVideoPlayback(videoRef, isActive, prefersReducedMotion);

  return (
    <article
      id="section-02"
      className={`garden-station garden-station--three-voices${isActive ? ' active' : ''}`}
      aria-hidden={isActive ? undefined : 'true'}
    >
      <div className="garden-station-content garden-station-content--center">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{h2}</h2>
        <div className="three-voices-video-wrap">
          <video
            ref={videoRef}
            className="three-voices-video"
            poster="/notepad-landing/notepad-demo-poster.jpg"
            preload="metadata"
            muted
            loop
            playsInline
            aria-label="A walkthrough of the Live Psalms notebook — writing devotions, sermons, and themes, with verses linked back to scripture."
          >
            <source src="/notepad-landing/notepad-demo.webm" type="video/webm" />
            <source src="/notepad-landing/notepad-demo.mp4" type="video/mp4" />
          </video>
        </div>
      </div>
    </article>
  );
}
