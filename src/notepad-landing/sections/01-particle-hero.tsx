import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { copy } from '../data/copy';

interface ParticleHeroProps {
  prm: boolean;
}

export function ParticleHero({ prm }: ParticleHeroProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shapeIdx, setShapeIdx] = useState(0);

  useEffect(() => {
    if (!canvasRef.current) return;
    let cleanup = () => {};
    let cancelled = false;
    import('../three/particle-system').then(({ mountParticleSystem }) => {
      if (cancelled || !canvasRef.current) return;
      const handle = mountParticleSystem(canvasRef.current, {
        prm,
        onShapeChange: setShapeIdx,
      });
      cleanup = handle.cleanup;
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [prm]);

  const { eyebrow, h1, sub, ctaPrimary, ctaGhost, ctaNote, activeFormLabel, shapeNames } = copy.section01;

  return (
    <section className="hero" aria-labelledby="hero-h1">
      <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />
      <div className="hero-content">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="hero-h1" className="hero-h1">{h1}</h1>
        <p className="hero-sub">{sub}</p>
        <div className="hero-actions">
          <Link to="/notebook/notes" className="cta-primary">{ctaPrimary}</Link>
          <a href="#section-02" className="cta-ghost">{ctaGhost}</a>
        </div>
        <p className="hero-cta-note">{ctaNote}</p>
      </div>
      <div className="hero-form-indicator" aria-hidden="true">
        <div className="form-label">{activeFormLabel}</div>
        <div className="form-name">{shapeNames[shapeIdx]}</div>
        <div className="form-counter">{`0${shapeIdx + 1} / 0${shapeNames.length}`}</div>
      </div>
    </section>
  );
}
