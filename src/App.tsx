import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { decideHeroIntro, persistIntroPlayed } from '@/components/sections/hero-intro-gate';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { MobileBottomDock } from '@/components/layout/MobileBottomDock';
import { Hero } from '@/components/sections/Hero';
import { HeroLoadingOverlay } from '@/components/sections/HeroLoadingOverlay';
import { MidSectionMotion } from '@/components/sections/MidSectionMotion';
import { TwoPathInterlude } from '@/components/sections/TwoPathInterlude';
import { PurposeGrid } from '@/components/sections/PurposeGrid';
import { FinalReflectionCta } from '@/components/sections/FinalReflectionCta';
import { WaterRipple } from '@/components/ui-custom/WaterRipple';
import { SplitTransition } from '@/components/ui-custom/SplitTransition';
import type { TransitionPhase } from '@/components/ui-custom/SplitTransition';
import { useLoadingOverlay } from '@/hooks/useLoadingOverlay';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppShellLock } from '@/hooks/useAppShellLock';
import { scaleForMobile } from '@/lib/motion-scale';
import { cn } from '@/lib/utils';
import { useProjectColors } from '@/hooks/useProjectColors';
import type { Project } from '@/types';
import { AuthProvider } from '@/auth/context/AuthProvider';
import { useRouteTransition } from '@/transitions/useRouteTransition';
import { RouteTransitionProvider } from '@/transitions/RouteTransitionContext';
import { LoadingOverlayContext } from '@/hooks/loading-overlay-context';
import { NavTriggerContext } from '@/hooks/nav-trigger-context';
import { ThemeProvider } from '@/notepad/theme/ThemeProvider';
import { BiblePrefsProvider } from '@/notepad/bible/prefs/BiblePrefsProvider';
import { RecordingsAudioProvider } from '@/notepad/recordings/audio-context';
import { NotepadCompatRedirect } from '@/routing/NotepadCompatRedirect';
import './App.css';

// ── Route-level code splitting ───────────────────────────────────────────────
// Only the homepage (Hero / MidSection / TwoPath / PurposeGrid) and the app
// shell (Header / Footer / dock / transitions) load eagerly — they're the LCP
// path. Every other route is split into its own chunk, so a visitor landing on
// `/` never downloads the notepad editor (tiptap), the admin charts (recharts),
// the auth pages, or the purpose deep-dives until they actually navigate there.
const NotepadLanding = lazy(() =>
  import('@/notepad-landing').then((m) => ({ default: m.NotepadLanding })),
);
const LocalNotepadLayout = lazy(() =>
  import('@/auth/username/NotepadRoutes').then((m) => ({ default: m.LocalNotepadLayout })),
);
const VanityNotepadLayout = lazy(() =>
  import('@/auth/username/NotepadRoutes').then((m) => ({ default: m.VanityNotepadLayout })),
);
const LegacyReflectionsRedirect = lazy(() =>
  import('@/auth/username/NotepadRoutes').then((m) => ({ default: m.LegacyReflectionsRedirect })),
);
const NotepadWorkspace = lazy(() =>
  import('@/components/sections/Notepad').then((m) => ({ default: m.NotepadWorkspace })),
);
const WaymarksReflectionsRoute = lazy(() =>
  import('@/notepad/components/waymarks/waymarks-routes').then((m) => ({ default: m.WaymarksReflectionsRoute })),
);
const WaymarksPeriodDetailRoute = lazy(() =>
  import('@/notepad/components/waymarks/waymarks-routes').then((m) => ({ default: m.WaymarksPeriodDetailRoute })),
);
const StudyWorkspace = lazy(() =>
  import('@/notepad/study/StudyWorkspace').then((m) => ({ default: m.StudyWorkspace })),
);
const CommunityComingSoon = lazy(() =>
  import('@/components/sections/CommunityComingSoon').then((m) => ({ default: m.CommunityComingSoon })),
);
const Contact = lazy(() =>
  import('@/components/sections/Contact').then((m) => ({ default: m.Contact })),
);
const PrivacyPolicy = lazy(() =>
  import('@/components/sections/PrivacyPolicy').then((m) => ({ default: m.PrivacyPolicy })),
);
const Terms = lazy(() =>
  import('@/components/sections/Terms').then((m) => ({ default: m.Terms })),
);
const LoginPage = lazy(() =>
  import('@/auth/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const ProfilePage = lazy(() =>
  import('@/auth/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const UpdatePasswordPage = lazy(() =>
  import('@/auth/UpdatePasswordPage').then((m) => ({ default: m.UpdatePasswordPage })),
);
const WelcomePage = lazy(() =>
  import('@/auth/WelcomePage').then((m) => ({ default: m.WelcomePage })),
);
const AdminLamplightPage = lazy(() =>
  import('@/admin/AdminLamplightPage').then((m) => ({ default: m.AdminLamplightPage })),
);
const PurposeDetail = lazy(() =>
  import('@/components/sections/PurposeDetail').then((m) => ({ default: m.PurposeDetail })),
);

if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

function App() {
  const location = useLocation();
  const projects = useProjectColors();
  // Single-shot computation of all the intro-related decisions at first mount.
  // useMemo with [] deps keeps it stable across re-renders and avoids
  // re-reading window state on every render.
  const initialDecision = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        homeIntroPlays: false,
        prefersReducedMotion: false,
      };
    }
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const decision = decideHeroIntro({
      storage: window.sessionStorage,
      prefersReducedMotion,
    });
    if (decision.persistFlag) {
      persistIntroPlayed(window.sessionStorage);
    }
    const isInitiallyOnHome = window.location.pathname === '/home';
    return {
      homeIntroPlays: isInitiallyOnHome && decision.playIntro,
      prefersReducedMotion,
    };
  }, []);

  const [introActive, setIntroActive] = useState<boolean>(initialDecision.homeIntroPlays);
  // Header is hidden during the home intro and fades in at the handoff beat
  // via showNav. On any path where the home intro doesn't play (session-skip
  // OR initial route is not /), the header starts visible — the loading
  // overlay sits above it during navigation.
  const [headerVisible, setHeaderVisible] = useState<boolean>(() => !initialDecision.homeIntroPlays);

  // Loading overlay starts inactive. Activation is driven exclusively by
  // handleNavTrigger from Header click sources (see below). Reduced-motion
  // suppression lives inside that wrapper. Mobile shortens the minimum hold
  // time per spec Decision 16 — snappier on phones, still long enough to
  // mask the route transition.
  const isMobile = useIsMobile();
  const overlay = useLoadingOverlay({
    minMs: scaleForMobile(1500, isMobile),
    initialActive: false,
  });

  // Tracks whether the loading overlay is covering the screen across its full
  // visible lifecycle — true the moment it activates (only ever via
  // handleNavTrigger below), false only once its dissolve finishes
  // (onCrossfadeComplete). Surfaced via LoadingOverlayContext so the onboarding
  // tour/checklist don't paint on top of the loading screen.
  const [overlayPresent, setOverlayPresent] = useState(false);
  const handleOverlayGone = useCallback(() => setOverlayPresent(false), []);

  const handleNavTrigger = useCallback(() => {
    if (initialDecision.prefersReducedMotion) return;
    setOverlayPresent(true);
    overlay.trigger();
  }, [overlay, initialDecision.prefersReducedMotion]);

  const handleIntroComplete = useCallback(() => {
    setIntroActive(false);
    if (typeof window !== 'undefined') {
      persistIntroPlayed(window.sessionStorage);
    }
  }, []);
  const handleIntroHandoff = useCallback(() => {
    setHeaderVisible(true);
  }, []);

  const { status, color, transition } = useRouteTransition(projects);

  // Shared curtain-navigation trigger for the deeply-nested NextDevotionHandoff
  // pill. Wired to the same beginNavigation the home grid uses.
  const routeTransitionValue = useMemo(
    () => ({ beginCurtainNavigation: transition.beginNavigation }),
    [transition],
  );

  const isDetailPage = location.pathname.startsWith('/purpose/');
  const isNotepadLanding = location.pathname === '/notebook';
  const isNotepadEditor =
    location.pathname.startsWith('/notebook/notes') ||
    location.pathname.startsWith('/notebook/u/');
  const isNotepadAny = isNotepadLanding || isNotepadEditor;
  const isLoginPage = location.pathname === '/login';
  const isProfilePage = location.pathname === '/profile';
  const isWelcomePage = location.pathname === '/welcome';
  const isUpdatePasswordPage = location.pathname === '/update-password';
  const isAppShell =
    isNotepadEditor ||
    isLoginPage ||
    isProfilePage ||
    isWelcomePage ||
    isUpdatePasswordPage;
  const isCommunityPage = location.pathname === '/community';
  const isContactPage = location.pathname === '/contact';
  const isLegalPage = location.pathname === '/privacy' || location.pathname === '/terms';
  const hideFooter = isDetailPage || isNotepadAny || isLoginPage || isProfilePage || isWelcomePage || isUpdatePasswordPage || isCommunityPage || isContactPage || isLegalPage;
  // Header + wrapper chrome stay off the notepad editor family (unchanged).
  const dockMounted = !isNotepadEditor && !isLoginPage && !isProfilePage && !isWelcomePage && !isUpdatePasswordPage;
  // The mobile bottom dock is suppressed across the ENTIRE notepad editor family
  // (`/notebook/notes` + `/notebook/u/:username` and every child — notes index,
  // Study, and Waymarks/reflections) so the floating MENU pill never appears once
  // the reader is inside the notebook. Each of those surfaces owns its own bottom
  // edge or in-page navigation (the notes/study tab bars, the relocated NotesMenu
  // hamburger, and the Waymarks "← Notebook" back link), so no site nav is lost.
  // The `/notebook` landing keeps the dock. This now mirrors the desktop
  // `dockMounted` gate above. isAppShell / the scroll lock are left unchanged.
  const mobileDockMounted =
    !isNotepadEditor &&
    !isLoginPage &&
    !isProfilePage &&
    !isWelcomePage &&
    !isUpdatePasswordPage;

  useAppShellLock(isAppShell);

  const handleProjectClick = useCallback(
    (project: Project) => transition.beginNavigation(`/purpose/${project.id}`, project.overlayColor),
    [transition],
  );

  const handleExitComplete = useCallback(() => transition.completeExit('/home'), [transition]);

  // Map the four-state status onto SplitTransition's three-state phase prop.
  // `exiting` is the text-fade pre-overlay phase, during which the overlay is hidden.
  const splitActive = status === 'expanding' || status === 'revealing';
  const splitPhase: TransitionPhase = splitActive ? status : 'idle';

  return (
    <AuthProvider>
      <ThemeProvider>
      <BiblePrefsProvider>
      <RouteTransitionProvider value={routeTransitionValue}>
        <LoadingOverlayContext.Provider value={overlayPresent}>
        <NavTriggerContext.Provider value={handleNavTrigger}>
        <div
          className={cn(
            'relative min-h-screen',
            // Mobile dock clearance keeps a normal page's last content above the
            // fixed bottom dock. The purpose-detail page closes on the
            // full-screen NextDevotionHandoff end-cap, which should bleed to the
            // bottom edge (the dock floats over its lower edge like any page;
            // the centered pill stays clear). Reserving clearance below it just
            // reveals the app-bg taupe as dead space — so skip it on detail.
            dockMounted && !isDetailPage && 'pb-[var(--mobile-dock-clearance)] md:pb-0',
          )}
          // On the notepad landing, paint the wrapper in the same near-black
          // as the closing CTA so the mobile dock-clearance padding zone
          // below the page (--mobile-dock-clearance) matches the section
          // above it instead of revealing the app-bg taupe. No visible
          // effect on desktop where pb collapses to 0 and the wrapper bg
          // is fully covered by the NotepadLanding's own paper background.
          style={{
            background: isNotepadLanding ? 'var(--dock-bg-dark)' : 'var(--app-bg)',
            zIndex: 1,
          }}
        >
        <div className="relative" style={{ zIndex: 1 }}>
          {dockMounted && <Header darkText={isDetailPage} showNav={headerVisible} onNavTrigger={handleNavTrigger} />}
          {mobileDockMounted && <MobileBottomDock onNavTrigger={handleNavTrigger} />}

          {/* ONE app-wide RecordingsAudioProvider, hoisted above <Routes> so
              in-app navigation out of the notebook (e.g. study logo → '/') never
              unmounts the voice-recording session — a pending/failed upload (its
              Blob in pendingRef) survives the route change and stays retryable
              (greptile P1, bar i). It sits under <AuthProvider> so
              useAuthSession() resolves, and is mounted EAGERLY (not lazy) so it
              does not stall every route behind Suspense. The Header/MobileBottomDock
              above don't use it and stay outside. Per-layout mounts were removed
              from NotepadRoutes.tsx to keep exactly one owner (one pendingRef). */}
          <RecordingsAudioProvider>
          <Suspense
            fallback={
              <div
                className="min-h-screen"
                aria-hidden="true"
                style={{ background: 'var(--app-bg)' }}
              />
            }
          >
          <Routes>
            {/* livepsalms.com now lands on the Notebook. The former marketing
                home is preserved at /home (reachable by direct URL); the
                hero-intro gate, purpose-page exit, and header isHome flag all
                key off /home so it still renders correctly there. */}
            <Route path="/" element={<Navigate to="/notebook" replace />} />
            <Route
              path="/home"
              element={
                <main>
                  <WaterRipple
                    rippleColor="rgba(40, 35, 30, 0.12)"
                    rippleDuration={1800}
                    maxRipples={6}
                    disabled={introActive}
                  >
                    <Hero introActive={introActive} onIntroComplete={handleIntroComplete} onHandoff={handleIntroHandoff} onNavTrigger={handleNavTrigger} />
                  </WaterRipple>
                  <MidSectionMotion />
                  <TwoPathInterlude />
                  <PurposeGrid projects={projects} onProjectClick={handleProjectClick} />
                </main>
              }
            />
            <Route path="/notebook" element={<NotepadLanding />} />
            <Route path="/notebook/notes" element={<LocalNotepadLayout />}>
              <Route index element={<NotepadWorkspace />} />
              <Route path="study" element={<StudyWorkspace />} />
            </Route>
            {/* Legacy /notebook/reflections(/:periodKey) — final-review fix (Critical 2):
                these are REDIRECTS only now, never a mount point. The Path has no local/
                offline mode, so it never lived under LocalNotepadLayout's signed-out
                Outlet in practice; that mount's `ready` branch also dropped the
                :periodKey suffix on redirect. LegacyReflectionsRedirect preserves the
                suffix and sends a signed-in reader to the vanity mount below. */}
            <Route path="/notebook/reflections" element={<LegacyReflectionsRedirect />} />
            <Route path="/notebook/reflections/:periodKey" element={<LegacyReflectionsRedirect />} />
            <Route path="/notebook/u/:username" element={<VanityNotepadLayout />}>
              <Route index element={<NotepadWorkspace />} />
              <Route path="study" element={<StudyWorkspace />} />
              <Route path="reflections" element={<WaymarksReflectionsRoute />} />
              <Route path="reflections/:periodKey" element={<WaymarksPeriodDetailRoute />} />
            </Route>
            {/* Backward-compat: old /notepad* links (bookmarks + already-sent
                auth emails) redirect to their /notebook* equivalents, search +
                hash preserved so OAuth callbacks still complete. The `/*` splat
                matches /notepad itself and every descendant — including the
                /notes/study and /u/:username/study children — so no old deep
                link falls through to a 404. */}
            <Route path="/notepad/*" element={<NotepadCompatRedirect />} />
            <Route path="/community" element={<CommunityComingSoon />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/update-password" element={<UpdatePasswordPage />} />
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/admin/lamplight" element={<AdminLamplightPage />} />
            <Route
              path="/purpose/:projectId"
              element={
                <PurposeDetailRoute
                  projects={projects}
                  exiting={status === 'exiting'}
                  onExitComplete={handleExitComplete}
                />
              }
            />
          </Routes>
          </Suspense>
          </RecordingsAudioProvider>

          {!hideFooter && <FinalReflectionCta />}
        </div>
      </div>

      {!hideFooter && <Footer />}

      <SplitTransition
        isActive={splitActive}
        overlayColor={color}
        phase={splitPhase}
        onPhaseComplete={transition.completePhase}
      />

      <div className="grain-bg" aria-hidden="true" />

      <HeroLoadingOverlay active={overlay.active} onCrossfadeComplete={handleOverlayGone} />
        </NavTriggerContext.Provider>
        </LoadingOverlayContext.Provider>
    </RouteTransitionProvider>
      </BiblePrefsProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

/** Wrapper that resolves the project from the URL param */
function PurposeDetailRoute({
  projects,
  exiting,
  onExitComplete,
}: {
  projects: Project[];
  exiting: boolean;
  onExitComplete: () => void;
}) {
  const { projectId } = useParams();
  const project = projects.find((p) => p.id === projectId);

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg text-mersi-dark/60">Project not found</p>
      </div>
    );
  }

  return (
    <PurposeDetail
      key={project.id}
      project={project}
      exiting={exiting}
      onExitComplete={onExitComplete}
    />
  );
}

export default App;
