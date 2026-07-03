// src/notepad-landing/sections/garden-scene/stations/03-lamplight.tsx
import { Link } from 'react-router-dom';
import { copy } from '../../../data/copy';

interface Props { isActive: boolean }

export function StationLamplight({ isActive }: Props) {
  const { eyebrow, h2, body, supporting, detail, cta } = copy.section04;
  return (
    <article
      id="section-04"
      className={`garden-station garden-station--lamplight${isActive ? ' active' : ''}`}
      aria-hidden={isActive ? undefined : 'true'}
    >
      <div className="garden-station-content garden-station-content--center">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{h2}</h2>
        <p className="body">{body}</p>
        <p className="supporting">{supporting}</p>
        <p className="supporting">{detail}</p>
        <Link to="/notebook/notes" className="cta-primary">{cta}</Link>
      </div>
    </article>
  );
}
