import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { PsalmsWordmarkSvg } from './PsalmsWordmarkSvg';
import { BRIDGE_COPY, bridgeCascadeKeyframes } from './hero-bridge-content';
import { applyKeyframes } from './motion-keyframes';
import { WORDMARK_COLLAPSE } from './hero-choreography/wordmark-geometry';
import { MOBILE_TIME_SCALE } from '@/lib/motion-scale';
import { cn } from '@/lib/utils';
import { useIntersectionStage } from '@/notepad-landing/hooks/use-intersection-stage';
import type { HeroProps } from './HeroDesktop';
import { HeroNotepadLink } from './HeroNotepadLink';
import { HeroMaskClipDef } from '@/components/ui-custom/HeroMaskClipDef';

gsap.registerPlugin(ScrollTrigger);

// Scroll distance the collapse plays over, expressed as a fraction of viewport
// height. Spec requires ≤ 60vh.
const MOBILE_COLLAPSE_VH = 60;

/**
 * Mobile-specific Hero composition. Same 4 beats as desktop — wordmark intro
 * (instant on mobile), shortened scroll-collapse (no pin), looping ambient
 * video (with poster fallback for reduced-motion), Psalm 23 quote sitting
 * directly under the wordmark, bridge copy — rebuilt for one-thumb scroll.
 */
export function HeroMobile({ introActive = false, onIntroComplete, onHandoff, onNavTrigger }: HeroProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const quoteRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<HTMLDivElement>(null);
  const bridgeInviteRef = useRef<HTMLParagraphElement>(null);
  const bridgeThesisRef = useRef<HTMLParagraphElement>(null);
  const bridgeAssureRef = useRef<HTMLParagraphElement>(null);

  // Cross-fade in once the quote enters the viewport. Graceful no-IO fallback
  // makes the content visible immediately when IntersectionObserver is absent.
  const quoteVisible = useIntersectionStage(quoteRef, { threshold: 0.4 });

  useEffect(() => {
    if (!introActive) return;
    onIntroComplete?.();
    onHandoff?.();
  }, [introActive, onIntroComplete, onHandoff]);

  // Snapshot at mount only; OS reduced-motion changes mid-session require a
  // reload. Matches HeroDesktop's pattern — listening for changes here would
  // require re-running GSAP setup mid-session with stale state.
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || prefersReducedMotion) return;

    const letters = {
      P: svg.querySelector<SVGGElement>('#letter-P'),
      S1: svg.querySelector<SVGGElement>('#letter-S1'),
      L: svg.querySelector<SVGGElement>('#letter-L'),
      M: svg.querySelector<SVGGElement>('#letter-M'),
      S2: svg.querySelector<SVGGElement>('#letter-S2'),
    };
    if (!letters.P || !letters.S1 || !letters.L || !letters.M || !letters.S2) return;

    // Wrap in a gsap.context so cleanup (ctx.revert) tears down BOTH the
    // timeline AND its ScrollTrigger in one call — matches HeroDesktop's
    // convention and survives future additions of more tweens inside this
    // effect without leaking ScrollTriggers.
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: svg,
          start: 'top top',
          // Functional `end` so ScrollTrigger.refresh() recomputes on resize/
          // orientation change (matches HeroDesktop pattern; spec note about
          // mobile Safari address bar resize).
          end: () => `+=${window.innerHeight * (MOBILE_COLLAPSE_VH / 100)}`,
          // scrub: 0.7 — snappier than desktop's 1.0; scaled by MOBILE_TIME_SCALE
          // so the constant remains the source of truth for "snappier on mobile".
          scrub: 1 * MOBILE_TIME_SCALE,
          pin: false,
          invalidateOnRefresh: true,
        },
      });

      tl.to(letters.P,  { x: WORDMARK_COLLAPSE.P,  ease: 'power2.inOut' }, 0)
        .to(letters.S1, { x: WORDMARK_COLLAPSE.S1, ease: 'power2.inOut' }, 0)
        .to(letters.L,  { x: WORDMARK_COLLAPSE.L,  ease: 'power2.inOut' }, 0)
        .to(letters.M,  { x: WORDMARK_COLLAPSE.M,  ease: 'power2.inOut' }, 0)
        .to(letters.S2, { x: WORDMARK_COLLAPSE.S2, ease: 'power2.inOut' }, 0);
    });

    return () => ctx.revert();
  }, [prefersReducedMotion]);

  /* ── Bridge cascade: pinned three-beat sequence. Mobile port of the
        desktop scrub-timeline. Text 1 rises from below; text 2 slides in
        from off-screen-right (x:30 — proportional to mobile viewport,
        equivalent to desktop's x:120 at 1440px); text 3 rises with more
        travel; kiss-handoff timing via BRIDGE_PIN_TIMING.
        scrub = 2 * MOBILE_TIME_SCALE for snappier mobile pace,
        matching the wordmark-collapse scrub above. ── */
  useEffect(() => {
    const scrollEl = bridgeRef.current;
    const t1 = bridgeInviteRef.current;
    const t2 = bridgeThesisRef.current;
    const t3 = bridgeAssureRef.current;
    if (!scrollEl || !t1 || !t2 || !t3) return;

    if (prefersReducedMotion) {
      // Reduced motion: clear any transform/blur state. The reduced-motion
      // JSX path renders the beats in normal flow (no pin), so visibility
      // is handled by the layout — we just neutralise any leftover GSAP
      // state from a previous mount.
      gsap.set([t1, t2, t3], { opacity: 1, y: 0, x: 0, filter: 'blur(0px)' });
      return;
    }

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: scrollEl,
          start: 'top 80%',
          end: 'bottom bottom',
          scrub: 2 * MOBILE_TIME_SCALE,
          invalidateOnRefresh: true,
        },
      });

      // Shared three-beat cascade. enterX2:30 — text 2's horizontal travel
      // (≈ 8% of a 360px viewport, matching the 120/1440 desktop proportion).
      applyKeyframes(tl, bridgeCascadeKeyframes({ enterX2: 30 }), { t1, t2, t3 });
    }, scrollEl);

    return () => ctx.revert();
  }, [prefersReducedMotion]);

  return (
    <div
      data-testid="hero-mobile"
      data-intro-active={introActive ? 'true' : 'false'}
      className="relative w-full min-h-[100svh]"
      style={{ backgroundColor: 'var(--app-bg)' }}
    >
      {/* Hidden SVG defs for the mask clip-path */}
      <HeroMaskClipDef />
      <div className="relative w-full flex flex-col items-center justify-center pt-10 pb-16 px-5 gap-10">
        <PsalmsWordmarkSvg ref={svgRef} className="w-[88vw] max-w-md" />
        <div
          ref={quoteRef}
          data-testid="hero-mobile-quote"
          data-visible={quoteVisible ? 'true' : 'false'}
          className={cn(
            'self-start text-left w-[70vw] max-w-md mt-2 transition-opacity duration-1000',
            quoteVisible ? 'opacity-100' : 'opacity-0',
          )}
        >
          <p className="quote-text italic text-[15px] leading-relaxed">
            "He leads me beside still waters.
          </p>
          <p className="quote-text italic text-[15px] leading-relaxed mt-2">
            He restores my soul."
          </p>
          <p className="quote-attr text-xs opacity-60 mt-5 inline-flex items-center justify-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block w-1.5 h-1.5 bg-[var(--accent-red,#d9483a)]"
            />
            Psalm 23:2-3
          </p>
        </div>
        <div
          data-testid="hero-mobile-video-mask"
          className="w-[88vw] max-w-md aspect-[5/3] overflow-hidden"
          style={{ clipPath: 'url(#hero-mask-clip)' }}
        >
          <video
            data-testid="hero-mobile-video"
            aria-hidden="true"
            src="/hero_main_video.mp4"
            poster="/tropical_jungle.webp"
            autoPlay={!prefersReducedMotion}
            muted
            playsInline
            loop
            preload="auto"
            className="w-full h-full object-cover"
          />
        </div>
        {/* Primary CTA into the journaling space — the hero text link with arrow
            (no pill), centered directly under the video mask. Fires the same
            loading-veil nav-trigger as the rest of the hero. */}
        <HeroNotepadLink onNavTrigger={onNavTrigger} label="Open your Notebook" animateArrow />
        {prefersReducedMotion ? (
          <section
            ref={bridgeRef}
            data-testid="hero-mobile-bridge"
            aria-label="Site introduction"
            className="relative w-full flex flex-col items-center justify-center px-6 py-24 text-center"
            style={{ minHeight: '100svh', backgroundColor: 'var(--paper-cream)' }}
          >
            <div className="flex flex-col items-center">
              <p ref={bridgeInviteRef} className="bridge-line-center">
                {BRIDGE_COPY.invitation}
              </p>
              <p ref={bridgeThesisRef} className="bridge-thesis mt-8">
                {BRIDGE_COPY.thesis}
              </p>
              <p ref={bridgeAssureRef} className="bridge-line-center mt-8">
                {BRIDGE_COPY.assurance}
              </p>
            </div>
          </section>
        ) : (
          <div
            ref={bridgeRef}
            data-testid="hero-mobile-bridge"
            className="relative w-full"
            style={{ height: '300svh' }}
          >
            <section
              aria-label="Site introduction"
              className="w-full overflow-hidden"
              style={{
                position: 'sticky',
                top: 0,
                height: '100svh',
                backgroundColor: 'var(--paper-cream)',
              }}
            >
              <p
                ref={bridgeInviteRef}
                className="bridge-beat bridge-beat-left bridge-line-side"
              >
                {BRIDGE_COPY.invitation}
              </p>
              <p
                ref={bridgeThesisRef}
                className="bridge-beat bridge-beat-right bridge-thesis"
              >
                {BRIDGE_COPY.thesis}
              </p>
              <p
                ref={bridgeAssureRef}
                className="bridge-beat bridge-beat-center bridge-line-center"
              >
                {BRIDGE_COPY.assurance}
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
