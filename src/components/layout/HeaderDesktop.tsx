import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { navItems, NAV_TRIGGER_LABELS } from '@/data/projects';
import { X, Menu } from 'lucide-react';
import {
  subscribeNavCollapseProgress,
  setNavCollapseProgress,
  getNavCollapseProgress,
} from '@/lib/nav-collapse-progress';
import { subscribeNavTheme, getNavTheme, type NavTheme } from '@/lib/nav-theme';
import {
  TextStaggerHover,
  TextStaggerHoverActive,
  TextStaggerHoverHidden,
} from '@/components/ui/text-stagger-hover';

gsap.registerPlugin(ScrollTrigger);

// Nav-collapse: per-element fade windows in [0,1] progress space. Order
// matches the visual left→right reading order. Indexes 0..3 are the four
// navItems anchors (Purpose, Notepad, Community, Contact); index 4 is the
// Social-block wrapper (em-dash + Social dropdown).
const NAV_WINDOWS: readonly { start: number; end: number }[] = [
  { start: 0.150, end: 0.310 }, // Purpose
  { start: 0.210, end: 0.370 }, // Notepad
  { start: 0.270, end: 0.430 }, // Community
  { start: 0.330, end: 0.490 }, // Contact
  { start: 0.390, end: 0.520 }, // Social-block
] as const;
const BURGER_WINDOW = { start: 0.45, end: 0.55 } as const;
const ITEM_TRANSLATE_PX = 28;
const ITEM_BLUR_PX = 3;

// Stand-alone ease helpers — pure math, no GSAP dependency. Used by the
// hot-path applyDom function which runs every scroll frame.
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const easePower1Out = (n: number): number => 1 - (1 - n);
const easePower2Out = (n: number): number => 1 - (1 - n) * (1 - n);
const easePower3Out = (n: number): number => 1 - (1 - n) * (1 - n) * (1 - n);

// NAV_TRIGGER_LABELS is the source of truth for which nav clicks fire the
// loading overlay. It lives in `@/data/projects` so HeaderMobile can share it.

function WaterText({ children, className, style, as: Tag = 'a', ...props }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties; as?: React.ElementType; [key: string]: unknown }) {
  const text = typeof children === 'string' ? children : '';

  return (
    <TextStaggerHover
      as={Tag}
      className={className}
      style={style}
      {...props}
    >
      <TextStaggerHoverActive animation="blur">{text}</TextStaggerHoverActive>
      <TextStaggerHoverHidden animation="blur">{text}</TextStaggerHoverHidden>
    </TextStaggerHover>
  );
}

export interface HeaderProps {
  showNav?: boolean;
  darkText?: boolean;
  /**
   * Called when the user clicks one of the trigger nav entries
   * (Logo, Purpose, Notepad, Community — and their mobile equivalents).
   * The logo suppresses this on same-path clicks; other entries fire
   * unconditionally. Optional so the component remains usable without it.
   */
  onNavTrigger?: () => void;
}

export function HeaderDesktop({ showNav = true, darkText = false, onNavTrigger }: HeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Nav-collapse refs. The DOM applier writes directly to these on every
  // scroll/scrub frame; no React state is involved.
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const burgerRef = useRef<HTMLButtonElement | null>(null);
  // State machine: 'scrub' (default), 'click-expanded' (user clicked burger),
  // 'resyncing' (first scroll input after click-expanded — tweening back).
  const stateRef = useRef<'scrub' | 'click-expanded' | 'resyncing'>('scrub');
  // Last progress value applyDom wrote. Used as the starting point for the
  // click-expand tween so it doesn't pop.
  const currentProgressRef = useRef<number>(0);
  // Active click-expand or resync tween, so we can kill it on re-entry.
  const activeTweenRef = useRef<gsap.core.Tween | null>(null);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const isHome = location.pathname === '/home';

  // Hot-path DOM applier. Reads the current progress and mutates inline
  // styles + aria attributes on each nav-item wrapper and on the burger.
  // Declared inside the component (closes over refs) but allocated once per
  // render — fine because the refs themselves are stable.
  const applyDom = (progress: number): void => {
    currentProgressRef.current = progress;
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const w = NAV_WINDOWS[i];
      const local = clamp01((progress - w.start) / (w.end - w.start));
      const x = ITEM_TRANSLATE_PX * easePower3Out(local);
      const op = 1 - easePower1Out(local);
      const blur = ITEM_BLUR_PX * easePower2Out(local);
      el.style.transform = `translateX(${x}px)`;
      el.style.opacity = String(op);
      el.style.filter = `blur(${blur}px)`;
      if (op < 0.05) {
        el.setAttribute('aria-hidden', 'true');
        el.style.pointerEvents = 'none';
      } else {
        el.removeAttribute('aria-hidden');
        el.style.pointerEvents = '';
      }
    });
    const burgerEl = burgerRef.current;
    if (burgerEl) {
      const local = clamp01((progress - BURGER_WINDOW.start) / (BURGER_WINDOW.end - BURGER_WINDOW.start));
      const op = easePower2Out(local);
      const scale = 0.7 + 0.3 * easePower2Out(local);
      burgerEl.style.opacity = String(op);
      burgerEl.style.transform = `translateY(-50%) scale(${scale})`;
      burgerEl.style.pointerEvents = progress >= 0.5 ? 'auto' : 'none';
      burgerEl.setAttribute(
        'aria-expanded',
        stateRef.current === 'click-expanded' ? 'true' : 'false',
      );
    }
  };

  // Tween between current progress and a target, using applyDom as the
  // per-frame setter. Kills any in-flight tween first so re-entry is safe.
  const tweenProgressTo = (target: number, duration: number, onComplete?: () => void): void => {
    activeTweenRef.current?.kill();
    const box = { progress: currentProgressRef.current };
    activeTweenRef.current = gsap.to(box, {
      progress: target,
      duration,
      ease: 'power2.out',
      onUpdate: () => applyDom(box.progress),
      onComplete: () => {
        activeTweenRef.current = null;
        onComplete?.();
      },
    });
  };

  // Burger click handler — entry point for click-expanded and the toggle
  // back. The first-scroll-input listener (attached in Effect 2 below) owns
  // the resync transition.
  const handleBurgerClick = (): void => {
    if (stateRef.current === 'click-expanded') {
      // Toggle back to collapsed without waiting for scroll.
      stateRef.current = 'resyncing';
      tweenProgressTo(getNavCollapseProgress(), 0.5, () => {
        stateRef.current = 'scrub';
      });
      return;
    }
    if (currentProgressRef.current < 0.5) return; // shouldn't happen — pointer-events gating
    stateRef.current = 'click-expanded';
    tweenProgressTo(0, 0.5);
  };

  // Adaptive nav-theme override — pages like the notepad landing publish a
  // 'dark' or 'light' value as the user scrolls past sections with different
  // backgrounds. When set, it wins over the static darkText prop so the nav
  // stays legible against whatever sits behind it.
  const [themeOverride, setThemeOverride] = useState<NavTheme>(() => getNavTheme());
  useEffect(() => subscribeNavTheme(setThemeOverride), []);

  // Soft-translucent text — paired with the glass text-shadow in
  // .psalms-nav-link (index.css). Flips to the light variant when the bg
  // behind the nav is dark (either via the per-route darkText prop or the
  // scroll-driven themeOverride).
  const isDarkBg = themeOverride !== null ? themeOverride === 'dark' : darkText;
  const textColor = isDarkBg ? 'rgba(255, 255, 255, 0.72)' : 'rgba(0, 0, 0, 0.65)';
  const hoverColor = isDarkBg ? 'rgba(255, 255, 255, 0.95)' : 'rgba(0, 0, 0, 0.9)';

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 100);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Nav-collapse: subscribe to progress; on non-home routes, run our own
  // ScrollTrigger as the publisher. On home, Hero is the publisher.
  useLayoutEffect(() => {
    if (prefersReducedMotion) return;

    let fallbackTrigger: ScrollTrigger | undefined;
    if (!isHome) {
      fallbackTrigger = ScrollTrigger.create({
        trigger: document.documentElement,
        start: 'top top-=40',
        end: 'top top-=360',
        scrub: 1,
        onUpdate: (self) => setNavCollapseProgress(self.progress),
      });
    }

    const unsubscribe = subscribeNavCollapseProgress((p) => {
      if (stateRef.current === 'scrub') applyDom(p);
    });

    return () => {
      unsubscribe();
      fallbackTrigger?.kill();
      // On the next mount the singleton's `current` will be whatever the
      // previous publisher last wrote — that's intentional, it prevents a
      // visual pop on route change.
    };
     
  }, [isHome, prefersReducedMotion]);

  // Nav-collapse: while click-expanded, the first scroll input from the user
  // triggers a smooth resync to the publisher's current value, then yields
  // back to scrub. Listeners are attached once at mount and use the state
  // ref to gate their behavior, avoiding per-state listener add/remove churn.
  useLayoutEffect(() => {
    if (prefersReducedMotion) return;

    const RESYNC_KEYS = new Set([
      'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ',
    ]);

    const handleResyncTrigger = (): void => {
      if (stateRef.current !== 'click-expanded') return;
      stateRef.current = 'resyncing';
      const target = getNavCollapseProgress();
      tweenProgressTo(target, 0.4, () => {
        stateRef.current = 'scrub';
      });
    };

    const onWheel = () => handleResyncTrigger();
    const onTouchMove = () => handleResyncTrigger();
    const onKeyDown = (e: KeyboardEvent) => {
      if (RESYNC_KEYS.has(e.key)) handleResyncTrigger();
    };

    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('keydown', onKeyDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefersReducedMotion]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [isMobileMenuOpen]);

  return (
    <header
      data-testid="header-desktop"
      className={`fixed top-0 left-0 right-0 z-50 bg-transparent transition-all duration-500 ${
        isScrolled ? 'py-3' : 'py-4 md:py-6'
      }`}
      style={{ perspective: '1000px' }}
    >
      <div className="w-full px-4 md:px-6 lg:px-10 flex items-center justify-between">
        {/* Logo - 3D emergence effect */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            if (location.pathname !== '/') {
              onNavTrigger?.();
            }
            navigate('/');
          }}
          className="flex items-center z-50 cursor-pointer"
          style={{
            opacity: showNav ? 1 : 0,
            transform: showNav 
              ? 'translateZ(0) rotateX(0deg) scale(1)' 
              : 'translateZ(-100px) rotateX(-25deg) scale(0.85)',
            filter: showNav ? 'blur(0px)' : 'blur(8px)',
            transition: 'all 3.5s cubic-bezier(0.16, 1, 0.3, 1)',
            transitionDelay: '0ms',
            transformOrigin: 'center top',
          }}
        >
          <img
            src="/logo-icon.png"
            alt="LivePsalms"
            className="h-8 md:h-10 w-auto object-contain"
            style={{
              filter: isDarkBg ? 'invert(1)' : 'invert(0)',
              transition: 'filter 300ms ease',
            }}
          />
        </a>

        {/* Desktop Navigation - 3D emergence effect */}
        <nav
          ref={navRef}
          id="primary-nav"
          className="hidden md:flex items-center gap-6 lg:gap-8"
          style={{
            opacity: showNav ? 1 : 0,
            transform: showNav
              ? 'translateZ(0) rotateX(0deg) scale(1)'
              : 'translateZ(-150px) rotateX(-35deg) scale(0.8)',
            filter: showNav ? 'blur(0px)' : 'blur(12px)',
            transition: 'all 3.5s cubic-bezier(0.16, 1, 0.3, 1)',
            transitionDelay: '600ms',
            transformOrigin: 'center top',
          }}
        >
          {navItems.map((item, index) => (
            <span
              key={item.label}
              ref={(el) => { itemRefs.current[index] = el; }}
              style={{ display: 'inline-flex', willChange: 'transform, opacity, filter' }}
            >
              <WaterText
                href={item.href}
                as="a"
                className="psalms-nav-link text-base lg:text-lg font-bold tracking-wide"
                style={{
                  fontFamily: "'The Softly Serif', serif",
                  opacity: showNav ? 1 : 0,
                  transform: showNav
                    ? 'translateY(0)'
                    : 'translateY(20px)',
                  transition: `opacity 2.5s cubic-bezier(0.16, 1, 0.3, 1) ${800 + index * 150}ms, transform 2.5s cubic-bezier(0.16, 1, 0.3, 1) ${800 + index * 150}ms, color 300ms ease, text-decoration-color 300ms ease`,
                  ['--c-rest' as string]: textColor,
                  ['--c-hover' as string]: hoverColor,
                } as React.CSSProperties}
                onClick={(e: React.MouseEvent) => {
                  if (NAV_TRIGGER_LABELS.has(item.label)) {
                    onNavTrigger?.();
                  }
                  if (item.href.startsWith('/')) {
                    e.preventDefault();
                    navigate(item.href);
                  }
                }}
              >
                {item.label}
              </WaterText>
            </span>
          ))}
          <div
            ref={(el) => { itemRefs.current[4] = el; }}
            className="flex items-center gap-6 lg:gap-8"
            style={{ willChange: 'transform, opacity, filter' }}
          >
            <span
              style={{
                color: textColor,
                opacity: showNav ? 0.3 : 0,
                transition: 'opacity 2s ease',
                transitionDelay: '1400ms',
              }}
            >—</span>
            <div
              className="relative group"
              style={{
                opacity: showNav ? 1 : 0,
                transform: showNav
                  ? 'translateY(0)'
                  : 'translateY(20px)',
                transition: 'all 2.5s cubic-bezier(0.16, 1, 0.3, 1)',
                transitionDelay: '1500ms',
              }}
            >
            <WaterText
              as="button"
              type="button"
              className="psalms-nav-link text-base lg:text-lg font-bold tracking-wide cursor-pointer"
              style={{
                fontFamily: "'The Softly Serif', serif",
                transition: 'color 300ms ease, text-decoration-color 300ms ease, opacity 300ms ease',
                ['--c-rest' as string]: textColor,
                ['--c-hover' as string]: hoverColor,
              } as React.CSSProperties}
            >
              Social
            </WaterText>
            <div
              className="absolute left-1/2 -translate-x-1/2 top-full pt-4 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300"
            >
              <div
                className="px-5 py-3 backdrop-blur-xl backdrop-saturate-150 rounded-sm shadow-sm"
                style={{
                  background: 'rgba(152, 143, 128, 0.55)',
                  border: '1px solid rgba(58, 52, 38, 0.08)',
                  WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
                }}
              >
                <WaterText
                  as="a"
                  href="https://instagram.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="psalms-nav-link block text-base lg:text-lg font-bold tracking-wide whitespace-nowrap"
                  style={{
                    fontFamily: "'The Softly Serif', serif",
                    transition: 'color 300ms ease, text-decoration-color 300ms ease, opacity 300ms ease',
                    ['--c-rest' as string]: textColor,
                    ['--c-hover' as string]: hoverColor,
                  } as React.CSSProperties}
                >
                  Instagram
                </WaterText>
              </div>
            </div>
          </div>
          </div>
        </nav>

        {/* Desktop hamburger — appears as the nav items collapse on scroll. */}
        {!prefersReducedMotion && (
          <button
            ref={burgerRef}
            type="button"
            onClick={handleBurgerClick}
            aria-label="Toggle navigation"
            aria-controls="primary-nav"
            className="hidden md:flex items-center justify-center w-10 h-10 absolute right-4 md:right-6 lg:right-10 top-1/2"
            style={{
              opacity: 0,
              transform: 'translateY(-50%) scale(0.7)',
              transformOrigin: 'center center',
              pointerEvents: 'none',
              color: textColor,
              transition: 'color 300ms ease',
              willChange: 'opacity, transform',
            }}
          >
            <Menu className="w-6 h-6" />
          </button>
        )}

        {/* Mobile Menu Button - 3D emergence effect */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="md:hidden flex items-center justify-center w-10 h-10 z-50"
          style={{
            opacity: showNav ? 1 : 0,
            transform: showNav
              ? 'translateZ(0) rotateX(0deg) scale(1)'
              : 'translateZ(-100px) rotateX(-25deg) scale(0.85)',
            filter: showNav ? 'blur(0px)' : 'blur(8px)',
            transition: 'all 3.5s cubic-bezier(0.16, 1, 0.3, 1)',
            transitionDelay: '600ms',
            transformOrigin: 'center top',
          }}
          aria-label="Toggle menu"
        >
          {isMobileMenuOpen ? (
            <X className="w-6 h-6" style={{ color: textColor, transition: 'color 300ms ease' }} />
          ) : (
            <Menu className="w-6 h-6" style={{ color: textColor, transition: 'color 300ms ease' }} />
          )}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      <div 
        className={`fixed inset-0 z-40 flex flex-col items-center justify-center transition-all duration-500 md:hidden ${
          isMobileMenuOpen 
            ? 'opacity-100 pointer-events-auto' 
            : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'var(--app-bg)' }}
      >
        <nav className="flex flex-col items-center gap-8">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={(e) => {
                if (NAV_TRIGGER_LABELS.has(item.label)) {
                  onNavTrigger?.();
                }
                if (item.href.startsWith('/')) {
                  e.preventDefault();
                  navigate(item.href);
                }
                setIsMobileMenuOpen(false);
              }}
              className="psalms-nav-link text-2xl font-bold tracking-wide"
              style={{
                fontFamily: "'The Softly Serif', serif",
                transition: 'color 300ms ease, text-decoration-color 300ms ease',
                ['--c-rest' as string]: textColor,
                ['--c-hover' as string]: hoverColor,
              } as React.CSSProperties}
            >
              {item.label}
            </a>
          ))}
          <div
            className="w-8 h-px my-2"
            style={{ background: '#000000', opacity: 0.2 }}
          />
          <a
            href="#social"
            onClick={() => setIsMobileMenuOpen(false)}
            className="psalms-nav-link text-2xl font-bold tracking-wide"
            style={{
              fontFamily: "'The Softly Serif', serif",
              transition: 'color 300ms ease, text-decoration-color 300ms ease',
              ['--c-rest' as string]: textColor,
              ['--c-hover' as string]: hoverColor,
            } as React.CSSProperties}
          >
            Social
          </a>
        </nav>
      </div>
    </header>
  );
}
