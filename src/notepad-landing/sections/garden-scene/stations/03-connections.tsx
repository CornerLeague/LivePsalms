// src/notepad-landing/sections/garden-scene/stations/03-connections.tsx
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { copy } from '../../../data/copy';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { useActiveVideoPlayback } from '../../../hooks/use-active-video-playback';

interface Props { isActive: boolean }

export function StationConnections({ isActive }: Props) {
  const { eyebrow, h2, body, supporting, detail, cta } = copy.section04;
  const videoRef = useRef<HTMLVideoElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useActiveVideoPlayback(videoRef, isActive, prefersReducedMotion);

  return (
    <article
      id="section-04"
      className={`garden-station garden-station--connections${isActive ? ' active' : ''}`}
      aria-hidden={isActive ? undefined : 'true'}
    >
      <div className="garden-station-pair">
        <div className="garden-station-content garden-station-content--left">
          <div className="connections-copy">
            <p className="eyebrow">{eyebrow}</p>
            <h2>{h2}</h2>
            <p className="body">{body}</p>
            <p className="supporting">{supporting}</p>
            <p className="supporting">{detail}</p>
          </div>
          <Link to="/notebook/notes" className="cta-primary">{cta}</Link>
        </div>
        <div className="connections-video-wrap">
          <video
            ref={videoRef}
            className="connections-video"
            poster="/notepad-connections-video-poster.jpg"
            preload="metadata"
            muted
            loop
            playsInline
            aria-label="A walkthrough of connections in Live Psalms — how your own notes link to one another and to scripture, with a connection card surfacing the thread between a verse or theme you return to over time."
          >
            <source src="/notepad-connections-video.webm" type="video/webm" />
            <source src="/notepad-connections-video.mp4"  type="video/mp4"  />
          </video>
        </div>
      </div>
    </article>
  );
}
