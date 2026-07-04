import './styles/landing.css';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { useAdaptiveNavTheme } from './hooks/use-adaptive-nav-theme';
import { ParticleHero } from './sections/01-particle-hero';
import { GardenScene } from './sections/garden-scene';
import { ClosingCTA } from './sections/09-closing-cta';

const NAV_THEME_SECTIONS_GARDEN = [
  { selector: '.notepad-landing .hero',          theme: 'dark' },
  { selector: '.notepad-landing .garden-scene',  theme: 'light' },
  { selector: '.notepad-landing .closing-cta',   theme: 'dark' },
] as const;

const NAV_THEME_SECTIONS_FALLBACK = [
  { selector: '.notepad-landing .hero',              theme: 'dark' },
  { selector: '.notepad-landing .three-voices',      theme: 'light' },
  { selector: '.notepad-landing .living-graph',      theme: 'light' },
  { selector: '.notepad-landing .connections',         theme: 'light' },
  { selector: '.notepad-landing .scripture-margin',  theme: 'light' },
  { selector: '.notepad-landing .seven-papers',      theme: 'light' },
  { selector: '.notepad-landing .tier-path',         theme: 'light' },
  { selector: '.notepad-landing .trust-import',      theme: 'light' },
  { selector: '.notepad-landing .closing-cta',       theme: 'dark' },
] as const;

export function NotepadLanding() {
  const prm = usePrefersReducedMotion();
  useAdaptiveNavTheme(prm ? NAV_THEME_SECTIONS_FALLBACK : NAV_THEME_SECTIONS_GARDEN);
  return (
    <div className="notepad-landing">
      <ParticleHero prm={prm} />
      <GardenScene prm={prm} />
      <ClosingCTA prm={prm} />
    </div>
  );
}
