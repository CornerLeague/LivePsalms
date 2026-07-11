import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { navItems, NAV_TRIGGER_LABELS } from '@/data/projects';
import { useIsMobile } from '@/hooks/use-mobile';
import { useScrollDirection } from '@/hooks/use-scroll-direction';
import { useAdaptiveDockTheme, type DockTheme } from '@/hooks/use-adaptive-dock-theme';
import { useKeyboardInset } from '@/components/sections/notepad/mobile/useKeyboardInset';
import { DockHomeSparkle, type DockHomeSparkleHandle } from './DockHomeSparkle';

interface MobileBottomDockProps {
  onNavTrigger?: () => void;
}

/**
 * Floating bottom dock for the mobile viewport (< 768px). Replaces the old
 * top `HeaderMobile`. Always visible at the top of the page; hides on
 * scroll-down; reveals on scroll-up. Tapping MENU expands a bottom-up
 * disclosure panel above the dock row; tapping CLOSE MENU collapses it.
 * Panel uses the WAI-ARIA Disclosure pattern (not a Dialog) — no backdrop,
 * no focus trap, no body-scroll lock. While the panel is open, the
 * hide-on-scroll-down behavior is suspended so the panel never scrolls
 * out from under the user mid-interaction.
 */
export function MobileBottomDock({ onNavTrigger }: MobileBottomDockProps) {
  const isMobile = useIsMobile();
  const dir = useScrollDirection();
  const location = useLocation();
  const [panelOpen, setPanelOpenRaw] = useState(false);
  const [socialExpanded, setSocialExpanded] = useState(false);
  const sparkleRef = useRef<DockHomeSparkleHandle>(null);
  // Adaptive cream-on-dark inversion is scoped to the notepad landing —
  // it's the only route designed with alternating dark/light sections
  // (hero → garden → CTA). Every other route stays locked to the cream
  // pill state (data-bg="dark") so the dock reads consistently. The hook
  // is unconditionally called (rules of hooks) but bails out when disabled.
  const isNotepadLanding = location.pathname === '/notebook';
  const adaptiveTheme = useAdaptiveDockTheme(isMobile && isNotepadLanding);
  const bgTheme: DockTheme = isNotepadLanding ? adaptiveTheme : 'dark';

  // Auto-close the panel when the route changes. Covers every navigation
  // path — link taps inside the panel, the logo tile, browser back/forward,
  // and programmatic navigation — without coupling to specific click
  // handlers. Initial mount with the panel already closed is a no-op.
  // MUST stay above the `if (!isMobile) return null` early return so the hook
  // count is stable across a viewport resize across the breakpoint — otherwise
  // React throws "Rendered fewer/more hooks than expected" and, with no error
  // boundary above it, the whole app unmounts to the bare app-bg.
  useEffect(() => {
    setPanelOpenRaw(false);
    setSocialExpanded(false);
  }, [location.pathname]);

  // Called before the `if (!isMobile) return null` early return so the hook
  // count stays stable across a viewport resize across the breakpoint.
  const keyboardInset = useKeyboardInset();

  if (!isMobile) return null;

  // Hide the dock while the on-screen keyboard is up so it never covers the
  // editor's bottom toolbar (which lifts into the dock's reserved slot).
  const visible = panelOpen ? true : (dir !== 'down' && keyboardInset === 0);

  // Wrapper rather than useEffect([panelOpen]) so the social reset is
  // synchronous with the close, not deferred one render. A deferred reset
  // would briefly leave the Instagram sub-row visible while the panel is
  // already collapsing, producing a flash.
  const setPanelOpen = (next: boolean): void => {
    setPanelOpenRaw(next);
    if (!next) setSocialExpanded(false);
  };

  return (
    <aside
      data-testid="mobile-bottom-dock"
      data-visible={visible ? 'true' : 'false'}
      data-panel-state={panelOpen ? 'open' : 'closed'}
      data-bg={bgTheme}
      aria-label="Quick navigation"
      className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pointer-events-none pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-300 motion-reduce:transition-none"
      style={{ transform: visible ? 'translateY(0)' : 'translateY(calc(100% + 1rem))' }}
    >
      <div className="pointer-events-auto flex flex-col items-center gap-2">
        <div id="mobile-menu-panel" className="menu-panel" aria-hidden={!panelOpen}>
          <ul className="menu-links">
            {navItems.map((item, i) => (
              <li key={item.label} style={{ ['--i' as string]: i + 1 } as CSSProperties}>
                <Link
                  to={item.href}
                  onClick={() => {
                    if (NAV_TRIGGER_LABELS.has(item.label)) onNavTrigger?.();
                  }}
                >
                  {item.label.toUpperCase()}
                </Link>
              </li>
            ))}
            <li
              key="social"
              className="social-row"
              data-social-state={socialExpanded ? 'open' : 'closed'}
              style={{ ['--i' as string]: navItems.length + 1 } as CSSProperties}
            >
              <div className="social-sub" aria-hidden={!socialExpanded}>
                <a
                  id="mobile-social-instagram"
                  href="https://instagram.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  INSTAGRAM ↗
                </a>
              </div>
              <button
                type="button"
                className="social-toggle"
                aria-expanded={socialExpanded}
                aria-controls="mobile-social-instagram"
                onClick={() => setSocialExpanded((v) => !v)}
              >
                SOCIAL
              </button>
            </li>
          </ul>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/"
            aria-label="Home"
            className="dock-home relative overflow-visible h-11 w-11 rounded-xl inline-flex items-center justify-center"
            onClick={() => sparkleRef.current?.burst()}
          >
            <img
              src="/logo-icon.png"
              alt=""
              className="h-6 w-6 object-contain"
            />
            <DockHomeSparkle ref={sparkleRef} />
          </Link>
          <button
            type="button"
            className="menu-toggle h-11 px-6 rounded-full text-white text-xs font-semibold tracking-[0.14em]"
            aria-expanded={panelOpen}
            aria-controls="mobile-menu-panel"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            {/* Both labels are always rendered; CSS display swap shows the
                active one. The mirrored aria-hidden props strip the
                inactive label from the accessible-name tree — required
                because JSDOM in tests doesn't honor display:none for
                accessible-name computation, and useful in real browsers
                for assistive tech that ignores display:none. */}
            <span className="text-menu" aria-hidden={panelOpen}>MENU</span>
            <span className="text-close" aria-hidden={!panelOpen}>CLOSE MENU</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
