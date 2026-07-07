import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { emitOnboardingEvent } from '../onboarding-events';
import { resolveAnchor as defaultResolveAnchor } from './anchor-resolver';
import {
  createTourEngine,
  type TourEngineDeps,
  type TourPlacement,
  type TourStep,
  type TourViewport,
} from './tour-engine';
import { getWorkspaceControls } from './workspace-controller';

// Motion constants (spec §4): calm ink-and-paper, low-bounce, no overshoot.
const SPOTLIGHT_SPRING = { type: 'spring', duration: 0.6, bounce: 0.15 } as const;
const ENTRANCE = { duration: 0.3, ease: [0.23, 1, 0.32, 1] } as const;
const CARD_WIDTH = 300;
const GAP = 16;
const EDGE_PAD = 16;
const CUTOUT_PAD = 6;
const SCRIM = 'rgba(38, 30, 22, 0.55)';
const SCROLL_SETTLE_MS = 350;

export interface SpotlightOverlayProps {
  steps: TourStep[];
  onComplete: () => void;
  onSkip: () => void;
  onSignUp: () => void;
  /** Injectable for tests; defaults to the DOM polling resolver. */
  resolveAnchor?: TourEngineDeps['resolveAnchor'];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function measure(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function resolvePlacement(step: TourStep, viewport: TourViewport): TourPlacement {
  return typeof step.placement === 'string' ? step.placement : step.placement[viewport];
}

function resolveBody(step: TourStep, viewport: TourViewport): string {
  return typeof step.copy.body === 'string' ? step.copy.body : step.copy.body[viewport];
}

// eslint-disable-next-line react-refresh/only-export-components
export function computeCardPosition(
  rect: Rect | null,
  placement: TourPlacement,
  card: { width: number; height: number },
  viewportSize: { width: number; height: number },
): { x: number; y: number } {
  if (rect === null || placement === 'center') {
    return {
      x: (viewportSize.width - card.width) / 2,
      y: (viewportSize.height - card.height) / 2,
    };
  }
  let x: number;
  let y: number;
  switch (placement) {
    case 'bottom':
      x = rect.x + rect.width / 2 - card.width / 2;
      y = rect.y + rect.height + GAP;
      break;
    case 'top':
      x = rect.x + rect.width / 2 - card.width / 2;
      y = rect.y - GAP - card.height;
      break;
    case 'left':
      x = rect.x - GAP - card.width;
      y = rect.y + rect.height / 2 - card.height / 2;
      break;
    case 'right':
      x = rect.x + rect.width + GAP;
      y = rect.y + rect.height / 2 - card.height / 2;
      break;
  }
  x = Math.min(Math.max(x, EDGE_PAD), Math.max(EDGE_PAD, viewportSize.width - card.width - EDGE_PAD));
  y = Math.min(Math.max(y, EDGE_PAD), Math.max(EDGE_PAD, viewportSize.height - card.height - EDGE_PAD));
  return { x, y };
}

/**
 * Same 768px breakpoint as use-mobile.ts, but guarded for environments
 * without matchMedia (jsdom) so the tour never crashes in tests.
 */
function computeTourViewport(): TourViewport {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 767px)').matches
    ? 'mobile'
    : 'desktop';
}

function useTourViewport(): TourViewport {
  const [viewport, setViewport] = useState<TourViewport>(() => computeTourViewport());
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const onChange = () => setViewport(mql.matches ? 'mobile' : 'desktop');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return viewport;
}

function FlickerFlame() {
  // The one delight moment (spec §4): the Lamplight step's 🕯 flickers.
  return (
    <motion.span
      style={{ display: 'inline-block' }}
      animate={{ opacity: [1, 0.72, 1] }}
      transition={{ duration: 1.8, times: [0, 0.5, 1], repeat: Infinity, ease: 'linear' }}
      aria-hidden="true"
    >
      🕯
    </motion.span>
  );
}

function StepTitle({ step, reduceMotion }: { step: TourStep; reduceMotion: boolean }) {
  const { title } = step.copy;
  if (reduceMotion || !title.includes('🕯')) return <>{title}</>;
  const [before, after] = title.split('🕯');
  return (
    <>
      {before}
      <FlickerFlame />
      {after}
    </>
  );
}

type ExitReason = 'complete' | 'skip' | 'signup';

export function SpotlightOverlay({
  steps,
  onComplete,
  onSkip,
  onSignUp,
  resolveAnchor = defaultResolveAnchor,
}: SpotlightOverlayProps) {
  const reduceMotion = usePrefersReducedMotion();
  const viewport = useTourViewport();

  // Exit choreography (spec §4): play the 200ms fade first, then fire the
  // real callback from onExitComplete. Exits are faster than entrances.
  const [exitReason, setExitReason] = useState<ExitReason | null>(null);
  const callbacksRef = useRef({ onComplete, onSkip, onSignUp });
  // eslint-disable-next-line react-hooks/refs
  callbacksRef.current = { onComplete, onSkip, onSignUp };

  const [engine] = useState(() =>
    createTourEngine({
      steps,
      initialViewport: computeTourViewport(),
      getControls: getWorkspaceControls,
      resolveAnchor,
      onComplete: () => setExitReason((prev) => prev ?? 'complete'),
      onSkip: () => setExitReason((prev) => prev ?? 'skip'),
      onStepSkipped: () => emitOnboardingEvent('tour-step-skipped'),
    }),
  );

  useEffect(() => {
    engine.start();
    return () => engine.dispose();
  }, [engine]);

  useEffect(() => {
    engine.setViewport(viewport);
  }, [engine, viewport]);

  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  const step = steps[state.stepIndex];
  const isFirst = state.stepIndex === 0;
  const isLast = state.stepIndex === steps.length - 1;

  // Keyboard: Escape skips instantly (spec §6); arrows navigate (decision 5).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') engine.skip();
      else if (event.key === 'ArrowRight') engine.next();
      else if (event.key === 'ArrowLeft') engine.back();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine]);

  // Scroll the resolved anchor into view, wait for the scroll to finish, then
  // measure and (only then) start listening for drift. Never scroll and morph
  // simultaneously (spec §4). inline:'nearest' also fixes the mobile bottom
  // toolbar's horizontal overflow for step 5 (spec §3 "VERIFY at 375px").
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (state.phase !== 'showing') return; // hold the previous cutout while preparing
    const el = state.anchorEl;
    if (el === null) {
      setTargetRect(null);
      return;
    }
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    const remeasure = () => {
      if (!cancelled) setTargetRect(measure(el));
    };
    el.scrollIntoView?.({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
    const timer = window.setTimeout(
      () => {
        if (cancelled) return;
        setTargetRect(measure(el));
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(remeasure);
          observer.observe(el);
        }
        window.addEventListener('resize', remeasure);
        window.addEventListener('scroll', remeasure, true);
      },
      reduceMotion ? 0 : SCROLL_SETTLE_MS,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, true);
    };
  }, [state.phase, state.anchorEl, reduceMotion]);

  // Card + viewport measurements for placement math.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState(200);
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const update = () => setCardHeight(node.offsetHeight);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const update = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const placement = resolvePlacement(step, state.viewport);
  const cardWidth = Math.min(CARD_WIDTH, viewportSize.width - EDGE_PAD * 2);
  const cardPos = computeCardPosition(
    targetRect,
    placement,
    { width: cardWidth, height: cardHeight },
    viewportSize,
  );
  // Full transform string, not x/y shorthands (spec §4 performance rule).
  const cardTransform = `translate3d(${Math.round(cardPos.x)}px, ${Math.round(cardPos.y)}px, 0) scale(1)`;
  const cardEnterTransform = `translate3d(${Math.round(cardPos.x)}px, ${Math.round(cardPos.y + 8)}px, 0) scale(0.96)`;
  const [entered, setEntered] = useState(false);

  const hasTarget = targetRect !== null;
  const spotRect: Rect = hasTarget
    ? {
        x: targetRect.x - CUTOUT_PAD,
        y: targetRect.y - CUTOUT_PAD,
        width: targetRect.width + CUTOUT_PAD * 2,
        height: targetRect.height + CUTOUT_PAD * 2,
      }
    : { x: viewportSize.width / 2, y: viewportSize.height / 2, width: 0, height: 0 };

  const handleExitComplete = () => {
    if (exitReason === 'skip') callbacksRef.current.onSkip();
    else if (exitReason === 'complete') callbacksRef.current.onComplete();
    else if (exitReason === 'signup') callbacksRef.current.onSignUp();
  };
  const beginSignUp = () => {
    engine.dispose();
    setExitReason((prev) => prev ?? 'signup');
  };

  const tap = reduceMotion ? undefined : { scale: 0.97, transition: { duration: 0.16 } };
  const primaryStyle: CSSProperties = {
    background: 'var(--deep-umber, #3a2f24)',
    color: 'var(--plaster, #f7f3ec)',
    border: 'none',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 14,
    fontFamily: 'Outfit, sans-serif',
    cursor: 'pointer',
  };
  const ghostStyle: CSSProperties = {
    background: 'transparent',
    color: 'var(--silica, #8a8175)',
    border: 'none',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 14,
    fontFamily: 'Outfit, sans-serif',
    cursor: 'pointer',
  };
  const cardBaseStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: cardWidth,
    background: 'var(--alabaster, #f7f3ec)',
    border: '1px solid var(--pale-stone, #e5ded3)',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 12px 32px rgba(38, 30, 22, 0.18)',
    willChange: 'transform',
  };

  const copyInitial = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 };
  const copyAnimate = reduceMotion
    ? { opacity: 1, transition: { duration: 0.15 } }
    : { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } };
  const copyExit = reduceMotion
    ? { opacity: 0, transition: { duration: 0.15 } }
    : { opacity: 0, filter: 'blur(2px)', transition: { duration: 0.15 } };

  const cardContent = (
    <>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step.id} initial={copyInitial} animate={copyAnimate} exit={copyExit}>
          <h2
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              color: 'var(--deep-umber, #3a2f24)',
              fontSize: 22,
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            <StepTitle step={step} reduceMotion={reduceMotion} />
          </h2>
          <p
            style={{
              color: 'var(--silica, #8a8175)',
              fontSize: 14,
              lineHeight: 1.5,
              margin: '8px 0 16px',
            }}
          >
            {resolveBody(step, state.viewport)}
          </p>
        </motion.div>
      </AnimatePresence>
      <div
        aria-label={`Step ${state.stepIndex + 1} of ${steps.length}`}
        style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14 }}
      >
        {steps.map((s, i) => (
          <span
            key={s.id}
            style={{
              height: 6,
              width: i === state.stepIndex ? 18 : 6,
              borderRadius: 999,
              background:
                i === state.stepIndex ? 'var(--marigold, #e8a93a)' : 'var(--pale-stone, #e5ded3)',
              transition: reduceMotion ? 'none' : 'width 200ms ease-out, background 200ms ease-out',
            }}
          />
        ))}
      </div>
      {isFirst ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <motion.button whileTap={tap} style={ghostStyle} onClick={() => engine.skip()}>
            Skip for now
          </motion.button>
          <motion.button whileTap={tap} style={primaryStyle} onClick={() => engine.next()}>
            Take the walk
          </motion.button>
        </div>
      ) : isLast ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <motion.button whileTap={tap} style={ghostStyle} onClick={() => engine.next()}>
            Not yet — keep exploring
          </motion.button>
          <motion.button whileTap={tap} style={primaryStyle} onClick={beginSignUp}>
            Create free account
          </motion.button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <motion.button whileTap={tap} style={ghostStyle} onClick={() => engine.skip()}>
            Skip
          </motion.button>
          <div style={{ flex: 1 }} />
          <motion.button whileTap={tap} style={ghostStyle} onClick={() => engine.back()}>
            Back
          </motion.button>
          <motion.button whileTap={tap} style={primaryStyle} onClick={() => engine.next()}>
            Next
          </motion.button>
        </div>
      )}
    </>
  );

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {exitReason === null && (
        <motion.div
          key="tour"
          role="dialog"
          aria-modal="true"
          aria-label="Onboarding walkthrough"
          className="fixed inset-0 z-[100]"
          style={{ fontFamily: 'Outfit, sans-serif', overflow: 'hidden' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.4, ease: 'easeOut' } }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
        >
          {/* Scrim-with-cutout: the 9999px spread paints the scrim; the inner
              ring is the marigold spotlight border (old-tour technique). The
              morph runs on Framer layout projection = transforms only, with
              automatic borderRadius/boxShadow correction (spec §4). Under
              reduced motion the cutout repositions instantly (no travel). */}
          <motion.div
            layout
            transition={reduceMotion ? { duration: 0 } : SPOTLIGHT_SPRING}
            style={{
              position: 'absolute',
              top: spotRect.y,
              left: spotRect.x,
              width: spotRect.width,
              height: spotRect.height,
              borderRadius: 12,
              pointerEvents: 'none',
              boxShadow: hasTarget
                ? `0 0 0 2px var(--marigold, #e8a93a), 0 0 0 9999px ${SCRIM}`
                : `0 0 0 9999px ${SCRIM}`,
            }}
          />
          {reduceMotion ? (
            <motion.div
              ref={cardRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              style={{ ...cardBaseStyle, transform: cardTransform }}
            >
              {cardContent}
            </motion.div>
          ) : (
            <motion.div
              ref={cardRef}
              initial={{ opacity: 0, transform: cardEnterTransform }}
              animate={{ opacity: 1, transform: cardTransform }}
              transition={entered ? SPOTLIGHT_SPRING : ENTRANCE}
              onAnimationComplete={() => setEntered(true)}
              style={cardBaseStyle}
            >
              {cardContent}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
