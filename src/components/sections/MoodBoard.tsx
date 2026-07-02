// src/components/sections/MoodBoard.tsx
import { useRef, useLayoutEffect, createElement } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/all';
import { useIsMobile } from '@/hooks/use-mobile';
import { categoryLabel, projects } from '@/data/projects';
import { devotions, type Devotion } from '@/data/devotions';
import {
  moodBoards,
  blendRecipeToColor,
  type DevotionMoodBoard,
  type DesktopSection,
  type DesktopElement,
  type MobileSection,
  type MobileElement,
} from '@/data/devotion-moodboards';
import { NewsletterDialog } from '@/components/sections/NewsletterDialog';
import { NextDevotionHandoff } from '@/components/sections/NextDevotionHandoff';
import { HeroMaskClipDef } from '@/components/ui-custom/HeroMaskClipDef';
import { PhotoDevelopImage } from '@/components/ui-custom/PhotoDevelopImage';
import type { Project } from '@/types';

// Used by NextDevotionHandoff when devotions[nextProject.id] is undefined
// (e.g. the next project in the array is a non-devotional project). Keeps
// the handoff renderable rather than crashing on a missing key.
const FALLBACK_DEVOTION: Devotion = {
  id: 'fallback',
  label: 'Next Devotion',
  title: 'Continue Reading',
  scriptureRef: '—',
  monogram: 'ND',
  firstMoodboardImage: '/mid_section/restoration1.webp',
};

gsap.registerPlugin(ScrollTrigger);

/* ── Shared CTA used by every Zone 7 (Continue Restoring …) ── */
type RestorationCTAProps = {
  purposeWord: string;
  overlayColor: string;
  /**
   * 'desktop' (default) is a 100vw flex-shrink-0 item inside the horizontal
   * moodboard track. 'mobile' is a full-width vertical section placed inline
   * before the mobile handoff — same content, no horizontal-track sizing.
   */
  variant?: 'desktop' | 'mobile';
};

function RestorationCTA({ purposeWord, overlayColor, variant = 'desktop' }: RestorationCTAProps) {
  const isMobile = variant === 'mobile';
  return (
    <div
      className={
        isMobile
          ? 'relative w-full min-h-screen flex items-center justify-center'
          : 'relative flex-shrink-0 h-screen flex items-center justify-center'
      }
      style={{
        ...(isMobile ? null : { width: '100vw' }),
        backgroundColor: `color-mix(in srgb, ${overlayColor} 95%, black 10%)`,
      }}
    >
      <div className="flex flex-col items-center text-center max-w-lg px-8">
        <h3
          className="font-['Cormorant_Garamond'] italic font-light text-white/90 leading-[1.15] mb-6"
          style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)' }}
        >
          Continue Restoring Your {purposeWord}
        </h3>
        <p className="text-sm text-white/50 tracking-wide leading-relaxed mb-8">
          Take a few moments to pause, reflect, and jot down what God is revealing to you.
        </p>
        <Link
          to="/notepad/notes"
          className="group inline-flex items-center gap-2 px-8 py-3.5 rounded-full border border-white/30 bg-white/5 text-base text-white/95 tracking-wide hover:bg-white/10 hover:border-white/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 mt-2"
        >
          Open your notebook
          <span
            aria-hidden="true"
            className="transition-transform duration-200 group-hover:translate-x-[3px] motion-reduce:transform-none"
          >
            →
          </span>
        </Link>
        <p className="mt-6 text-xs text-white/40 tracking-wide">
          Or{' '}
          <NewsletterDialog>
            <button
              type="button"
              className="underline underline-offset-4 decoration-white/30 text-white/70 hover:text-white hover:decoration-white/60 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded-sm"
            >
              join our newsletter
            </button>
          </NewsletterDialog>
        </p>
      </div>
    </div>
  );
}

interface MoodBoardProps {
  project: Project;
  onInMoodBoard?: (inMoodBoard: boolean) => void;
}

export function MoodBoard({ project, onInMoodBoard }: MoodBoardProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const progressTrackRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const onInMoodBoardRef = useRef(onInMoodBoard);
  onInMoodBoardRef.current = onInMoodBoard;
  const currentIndex = projects.findIndex((p) => p.id === project.id);
  const nextProject = projects[(currentIndex + 1) % projects.length];
  const nextDevotion = devotions[nextProject.id] ?? FALLBACK_DEVOTION;

  // All migrated devotions render from the shared data model via MoodBoardZones
  // / MoodBoardStack. `board` is undefined only for generic fallback devotions
  // (DefaultZones / MoodBoardMobile). The desktop NextDevotionHandoff sibling
  // is gated on `board` because the data-driven moodboard owns that final panel.
  const board = moodBoards[project.id];
  const overlayColor = project.overlayColor;
  const purposeWord = (devotions[project.id]?.label ?? '').split(' ').pop() ?? '';

  useLayoutEffect(() => {
    if (isMobile || !sectionRef.current || !trackRef.current) return;

    const track = trackRef.current;

    const ctx = gsap.context(() => {
      // Main horizontal scroll tween — store reference for containerAnimation
      const mainTween = gsap.to(track, {
        x: () => -(track.scrollWidth - window.innerWidth),
        ease: 'none',
        scrollTrigger: {
          id: 'moodboard-pin',
          trigger: sectionRef.current,
          start: 'top top',
          end: () => `+=${track.scrollWidth - window.innerWidth}`,
          pin: true,
          scrub: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            if (progressBarRef.current) {
              progressBarRef.current.style.width = `${self.progress * 100}%`;
            }
            if (progressTrackRef.current) {
              progressTrackRef.current.style.opacity =
                self.progress > 0 && self.progress < 1 ? '1' : '0';
            }
            onInMoodBoardRef.current?.(self.progress > 0 && self.progress < 1);
          },
          onLeave: () => onInMoodBoardRef.current?.(false),
          onLeaveBack: () => onInMoodBoardRef.current?.(false),
        },
      });

      // Parallax: offset each element by its data-speed factor
      gsap.utils.toArray<HTMLElement>('.mb-elem').forEach((el) => {
        const speed = parseFloat(el.dataset.speed || '0.5');
        gsap.to(el, {
          x: () => -(speed - 0.5) * (track.scrollWidth - window.innerWidth) * 0.3,
          ease: 'none',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top top',
            end: () => `+=${track.scrollWidth - window.innerWidth}`,
            scrub: 1,
          },
        });
      });

      // Reveal animations
      gsap.utils.toArray<HTMLElement>('.mb-elem').forEach((el) => {
        const isText = el.tagName === 'H2' || el.tagName === 'H3' || el.tagName === 'P' ||
                       el.classList.contains('text-xs') || el.classList.contains('text-sm') ||
                       el.classList.contains('text-white') || el.classList.contains('mb-text');
        const hasImage = el.querySelector('img');

        if (isText && !hasImage) {
          el.style.overflow = 'hidden';
          const inner = document.createElement('div');
          inner.style.willChange = 'transform';
          while (el.firstChild) inner.appendChild(el.firstChild);
          el.appendChild(inner);

          const isHeadline = el.tagName === 'H2' || el.tagName === 'H3';
          const dur = isHeadline ? 1.4 : 1.1;

          gsap.fromTo(
            inner,
            { yPercent: 110 },
            {
              yPercent: 0,
              duration: dur,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: el,
                containerAnimation: mainTween,
                start: 'left 90%',
                end: 'left 50%',
                toggleActions: 'play none none reverse',
              },
            }
          );
        } else {
          const isCaption = el.classList.contains('text-xs') || el.classList.contains('text-sm');
          const xOffset = isCaption ? 40 : 60;
          const dur = isCaption ? 0.9 : 1.1;

          gsap.fromTo(
            el,
            { opacity: 0, x: xOffset },
            {
              opacity: parseFloat(el.style.opacity) || 1,
              x: 0,
              duration: dur,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: el,
                containerAnimation: mainTween,
                start: 'left 90%',
                end: 'left 50%',
                toggleActions: 'play none none reverse',
              },
            }
          );
        }
      });

      // Stagger reveal for list items
      gsap.utils.toArray<HTMLElement>('.mb-list-item').forEach((item, i) => {
        gsap.fromTo(
          item,
          { opacity: 0, x: 40 },
          {
            opacity: 1,
            x: 0,
            duration: 0.8,
            delay: i * 0.1,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: item.closest('.mb-elem') || item,
              containerAnimation: mainTween,
              start: 'left 85%',
              toggleActions: 'play none none reverse',
            },
          }
        );
      });

      // Scale effect on large images
      gsap.utils.toArray<HTMLElement>('.mb-elem img').forEach((img) => {
        const parent = img.closest<HTMLElement>('.mb-elem');
        if (!parent) return;
        const isLarge = parent.classList.contains('w-[45vw]') ||
                        parent.classList.contains('w-[35vw]') ||
                        parent.classList.contains('w-[50vw]') ||
                        parent.classList.contains('w-[40vw]');
        if (!isLarge) return;

        gsap.fromTo(
          img,
          { scale: 1.05 },
          {
            scale: 1,
            ease: 'none',
            scrollTrigger: {
              trigger: parent,
              containerAnimation: mainTween,
              start: 'left 80%',
              end: 'left 20%',
              scrub: true,
            },
          }
        );
      });
    }, sectionRef);

    return () => ctx.revert();
  }, [isMobile]);

  const bgColor = project.overlayColor;

  if (isMobile) {
    const mobileNode = board ? (
      <MoodBoardStack
        board={board}
        project={project}
        overlayColor={overlayColor}
        purposeWord={purposeWord}
        nextProject={nextProject}
        nextDevotion={nextDevotion}
      />
    ) : (
      <MoodBoardMobile project={project} />
    );
    return (
      <>
        <HeroMaskClipDef />
        {mobileNode}
      </>
    );
  }

  return (
    <>
      <HeroMaskClipDef />
      <div ref={sectionRef} className="relative overflow-hidden" style={{ backgroundColor: bgColor }}>
        <div
          ref={trackRef}
          className="flex h-screen will-change-transform"
        >
          {board ? (
            <MoodBoardZones board={board} overlayColor={overlayColor} purposeWord={purposeWord} />
          ) : (
            <DefaultZones project={project} />
          )}

          {/* Zone 8: NextDevotionHandoff — final panel of the horizontal
              moodboard. Reached by the same horizontal scroll as zones 1–7
              so it reads as part of the same sequence. */}
          {board && (
            <NextDevotionHandoff
              currentProject={project}
              nextProject={nextProject}
              nextDevotion={nextDevotion}
              inHorizontalTrack
            />
          )}
        </div>

        {/* Progress bar */}
        <div
          ref={progressTrackRef}
          className="fixed bottom-0 left-0 right-0 h-[2px] z-50 transition-opacity duration-300"
          style={{
            backgroundColor: 'rgba(255,255,255,0.15)',
            opacity: 0,
          }}
        >
          <div
            ref={progressBarRef}
            className="h-full bg-white/60"
            style={{ width: '0%' }}
          />
        </div>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   DEFAULT ZONES — existing generic moodboard
   ════════════════════════════════════════════════════════════════ */

function DefaultZones({ project }: { project: Project }) {
  // Next Devotion chains across all projects in declared order:
  // residential → hospitality → wraps back to residential.
  const currentIndex = projects.findIndex(p => p.id === project.id);
  const nextProject = projects[(currentIndex + 1) % projects.length];

  return (
    <>
      {/* Zone 1: Hero */}
      <div className="relative flex-shrink-0 h-screen" style={{ width: '200vw' }}>
        <div
          className="mb-elem absolute top-[15%] left-[8%] w-[45vw] h-[70vh] overflow-hidden"
          data-speed="0.3"
        >
          <PhotoDevelopImage
            src={project.thumbnail}
            alt={project.name}
            className="w-full h-full"
            threshold={0.05}
          />
        </div>

        <h2
          className="mb-elem absolute bottom-[20%] right-[15%] text-[12vw] font-bold leading-[0.85] tracking-tighter text-white/90"
          data-speed="0.5"
        >
          {project.name.toUpperCase()}
        </h2>

        <div
          className="mb-elem absolute top-[25%] right-[25%] text-sm tracking-wide max-w-[200px] leading-relaxed text-white/60"
          data-speed="0.7"
        >
          <p>{project.description || 'A space where architecture meets editorial design.'}</p>
        </div>
      </div>

      {/* Zone 2: Data */}
      <div className="relative flex-shrink-0 h-screen" style={{ width: '180vw', backgroundColor: `color-mix(in srgb, ${project.overlayColor} 85%, var(--app-bg))` }}>
        <div
          className="mb-elem absolute top-[10%] left-[5%] bg-white p-4 shadow-lg"
          data-speed="0.8"
        >
          <PhotoDevelopImage
            src={project.images[1] || project.thumbnail}
            alt={`${project.name} detail`}
            className="w-[280px] h-[360px]"
            threshold={0.05}
          />
          <p className="text-xs mt-3 tracking-wide text-black/60">
            {project.location || 'Location'} — {project.year || '2025'}
          </p>
        </div>

        {project.area && (
          <div
            className="mb-elem absolute top-[50%] left-[35%] text-[18vw] font-bold text-white/10 leading-none"
            data-speed="0.2"
          >
            {project.area}m²
          </div>
        )}

        <div
          className="mb-elem absolute bottom-[15%] right-[20%] w-[35vw] h-[50vh] overflow-hidden"
          data-speed="0.4"
        >
          <PhotoDevelopImage
            src={project.images[2] || project.thumbnail}
            alt={`${project.name} view`}
            className="w-full h-full"
            threshold={0.05}
          />
        </div>

        {project.services && project.services.length > 0 && (
          <div
            className="mb-elem absolute top-[35%] right-[8%] max-w-[180px]"
            data-speed="0.9"
          >
            <div className="space-y-3 text-xs tracking-wide">
              {project.services.map((service, i) => (
                <div key={service.id} className="mb-list-item flex items-start gap-3">
                  <span className="text-white/40">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-white/70">{service.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Zone 3: Craft */}
      <div className="relative flex-shrink-0 h-screen" style={{ width: '220vw', backgroundColor: `color-mix(in srgb, ${project.overlayColor} 70%, black 10%)` }}>
        <h3
          className="mb-elem absolute top-[20%] left-[10%] text-[10vw] font-bold text-white leading-none tracking-tight"
          data-speed="0.6"
        >
          CRAFT
        </h3>

        <div
          className="mb-elem absolute top-[55%] left-[25%] w-[50vw] h-[35vh] overflow-hidden"
          data-speed="0.3"
        >
          <PhotoDevelopImage
            src={project.images[3] || project.images[1] || project.thumbnail}
            alt={`${project.name} craft`}
            className="w-full h-full"
            threshold={0.05}
          />
        </div>

        <div
          className="mb-elem absolute bottom-[25%] right-[15%] text-white/80 text-sm max-w-[250px] leading-relaxed tracking-wide"
          data-speed="0.8"
        >
          <p>
            {project.description || 'Every detail matters. From material selection to spatial flow, we consider how spaces evolve with their inhabitants.'}
          </p>
        </div>

        <div
          className="mb-elem absolute top-[15%] right-[25%] bg-white/95 p-3 shadow-xl"
          data-speed="0.7"
        >
          <PhotoDevelopImage
            src={project.images[4] || project.images[0]}
            alt="Detail study"
            className="w-[200px] h-[250px]"
            threshold={0.05}
          />
          <p className="text-[10px] mt-2 tracking-wider text-black/50 uppercase">Detail Study</p>
        </div>
      </div>

      {/* Zone 4: Year */}
      <div className="relative flex-shrink-0 h-screen" style={{ width: '200vw', backgroundColor: `color-mix(in srgb, ${project.overlayColor} 90%, black 5%)` }}>
        <div
          className="mb-elem absolute top-[30%] left-[15%] text-[14vw] font-bold text-white/15 leading-none"
          data-speed="0.25"
        >
          {project.year || '2025'}
        </div>

        <div
          className="mb-elem absolute top-[20%] right-[20%] w-[40vw] h-[60vh] overflow-hidden shadow-2xl"
          data-speed="0.5"
        >
          <PhotoDevelopImage
            src={project.images[5] || project.thumbnail}
            alt={`${project.name} featured`}
            className="w-full h-full"
            threshold={0.05}
          />
        </div>

        <p
          className="mb-elem absolute bottom-[20%] left-[20%] text-white text-xs tracking-widest uppercase"
          data-speed="0.75"
        >
          {categoryLabel[project.category]}
        </p>
      </div>

      {/* Zone 5: CTA */}
      <div className="relative flex-shrink-0 h-screen flex items-center justify-center" style={{ width: '100vw', backgroundColor: 'rgba(0,0,0,0.15)' }}>
        <div className="text-center">
          <h3 className="text-[8vw] font-bold text-white mb-8 tracking-tight">
            Let's Talk
          </h3>
          <p className="text-white/70 text-sm tracking-wide mb-12 max-w-md mx-auto">
            Ready to create something extraordinary? Reach out and let's start a conversation about your next project.
          </p>
          <button className="px-8 py-4 bg-white text-mersi-dark text-sm tracking-wide hover:bg-white/90 transition-colors">
            Get in Touch
          </button>
        </div>
      </div>

      {/* Zone 6: Next Devotion Hero */}
      <div className="relative flex-shrink-0 h-screen" style={{ width: '100vw', backgroundColor: nextProject.overlayColor }}>
        <div className="grid grid-cols-2 h-full">
          <div className="relative flex flex-col justify-start px-16 pt-28 pb-20">
            <p className="text-xs tracking-[0.25em] uppercase text-white/50 mb-10">
              Next Devotion
            </p>
            <h3
              className="font-['Cormorant_Garamond'] italic font-light text-white/90 tracking-tight mb-12"
              style={{ fontSize: 'clamp(2.5rem, 5.5vw, 5.5rem)', lineHeight: 0.95 }}
            >
              {nextProject.name}
            </h3>
            {nextProject.description && (
              <p className="text-lg text-white/60 max-w-md leading-relaxed">
                {nextProject.description}
              </p>
            )}
          </div>
          <div className="relative h-full overflow-hidden">
            <PhotoDevelopImage
              src={nextProject.thumbnail}
              alt={nextProject.name}
              className="w-full h-full"
              threshold={0.05}
            />
          </div>
        </div>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   DATA-DRIVEN RENDERERS — one model, two arrangements.
   MoodBoardZones = desktop horizontal track; MoodBoardStack = mobile stack.
   Geometry and classes come verbatim from src/data/devotion-moodboards.tsx;
   these renderers own only the grammar: the image-wrapper shape, BlendRecipe→
   color expansion, PhotoDevelopImage props, the shared RestorationCTA /
   NextDevotionHandoff, and full-vs-mobile text selection.
   ════════════════════════════════════════════════════════════════ */

function renderDesktopElement(el: DesktopElement, key: number) {
  if (el.kind === 'image') {
    return (
      <div
        key={key}
        className={`mb-elem absolute ${el.pos} overflow-hidden`}
        style={el.style}
        data-speed="0.5"
      >
        <PhotoDevelopImage
          src={el.src}
          alt={el.alt}
          className={el.imgWrapClassName ?? 'w-full h-full'}
          imgClassName={el.imgClassName}
          threshold={el.threshold}
          revealed={el.revealed}
        />
      </div>
    );
  }
  return createElement(
    el.tag,
    { key, className: el.className, style: el.style, 'data-speed': '0.5' },
    el.text.full,
  );
}

function MoodBoardZones({
  board,
  overlayColor,
  purposeWord,
}: {
  board: DevotionMoodBoard;
  overlayColor: string;
  purposeWord: string;
}) {
  const ov = board.overlayColor ?? overlayColor;
  const word = board.purposeWord ?? purposeWord;
  return (
    <>
      {board.sections.map((section: DesktopSection, si) => (
        <div
          key={si}
          className="relative flex-shrink-0 h-screen"
          style={{
            width: section.width,
            ...(section.bg ? { backgroundColor: blendRecipeToColor(section.bg, ov) } : null),
          }}
        >
          {section.elements.map((el, ei) => renderDesktopElement(el, ei))}
        </div>
      ))}
      <RestorationCTA purposeWord={word} overlayColor={ov} />
    </>
  );
}

function renderMobileElement(el: MobileElement, key: number) {
  if (el.kind === 'image') {
    return <PhotoDevelopImage key={key} src={el.src} alt={el.alt} className={el.className} />;
  }
  if (el.kind === 'divider') {
    return <div key={key} className={el.className} />;
  }
  return createElement(
    el.tag,
    { key, className: el.className, style: el.style },
    el.text.mobile ?? el.text.full,
  );
}

function MoodBoardStack({
  board,
  project,
  overlayColor,
  purposeWord,
  nextProject,
  nextDevotion,
}: {
  board: DevotionMoodBoard;
  project: Project;
  overlayColor: string;
  purposeWord: string;
  nextProject: Project;
  nextDevotion: Devotion;
}) {
  const ov = board.overlayColor ?? overlayColor;
  const word = board.purposeWord ?? purposeWord;
  return (
    <div style={{ backgroundColor: ov }}>
      {board.mobile.map((section: MobileSection, si) => (
        <section
          key={si}
          className={section.className}
          style={
            section.bg === undefined
              ? undefined
              : { backgroundColor: section.bg === 'base' ? ov : blendRecipeToColor(section.bg, ov) }
          }
        >
          {section.elements.map((el, ei) => renderMobileElement(el, ei))}
        </section>
      ))}
      <RestorationCTA
        purposeWord={word}
        overlayColor={project.overlayColor}
        variant="mobile"
      />
      <NextDevotionHandoff
        currentProject={project}
        nextProject={nextProject}
        nextDevotion={nextDevotion}
        variant="mobile"
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   DEFAULT MOBILE — existing generic fallback
   ════════════════════════════════════════════════════════════════ */

function MoodBoardMobile({ project }: { project: Project }) {
  const label = categoryLabel[project.category];

  return (
    <div style={{ backgroundColor: project.overlayColor }}>
      {/* Zone 1: Hero */}
      <section className="min-h-screen p-6 flex flex-col justify-center">
        <PhotoDevelopImage
          src={project.thumbnail}
          alt={project.name}
          className="w-full h-[60vh] mb-8"
        />
        <h2 className="text-[15vw] font-bold text-white/90 leading-none mb-4">
          {project.name.toUpperCase()}
        </h2>
        <p className="text-sm text-white/60 leading-relaxed max-w-sm">
          {project.description || 'A space where architecture meets editorial design.'}
        </p>
      </section>

      {/* Zone 2: Data */}
      <section className="min-h-screen p-6 flex flex-col justify-center">
        <div className="bg-white p-4 shadow-lg w-fit mb-8">
          <PhotoDevelopImage
            src={project.images[1] || project.thumbnail}
            alt={`${project.name} detail`}
            className="w-[240px] h-[300px]"
          />
          <p className="text-xs mt-3 text-black/60">
            {project.location || 'Location'} — {project.year || '2025'}
          </p>
        </div>
        {project.area && (
          <div className="text-[20vw] font-bold text-white/10 mb-8">{project.area}m²</div>
        )}
        {project.services && (
          <div className="space-y-3 text-sm">
            {project.services.map((service, i) => (
              <div key={service.id} className="flex gap-3">
                <span className="text-white/40">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-white/70">{service.name}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Zone 3: Craft */}
      <section className="min-h-screen p-6 flex flex-col justify-center">
        <h3 className="text-[15vw] font-bold text-white leading-none mb-8">CRAFT</h3>
        <PhotoDevelopImage
          src={project.images[3] || project.images[1] || project.thumbnail}
          alt={`${project.name} craft`}
          className="w-full h-[40vh] mb-8"
        />
        <p className="text-white/80 text-sm leading-relaxed">
          {project.description || 'Every detail matters. From material selection to spatial flow, we consider how spaces evolve with their inhabitants.'}
        </p>
      </section>

      {/* Zone 4: Year */}
      <section className="min-h-screen p-6 flex flex-col justify-center">
        <div className="text-[20vw] font-bold text-white/15 mb-8">{project.year || '2025'}</div>
        <PhotoDevelopImage
          src={project.images[5] || project.thumbnail}
          alt={`${project.name} featured`}
          className="w-full h-[50vh] mb-4"
        />
        <p className="text-white text-xs tracking-widest uppercase">{label}</p>
      </section>

      {/* Zone 5: CTA */}
      <section className="min-h-screen p-6 flex flex-col justify-center items-center text-center">
        <h3 className="text-[12vw] font-bold text-white mb-6">Let's Talk</h3>
        <p className="text-white/70 text-sm mb-8 max-w-sm">
          Ready to create something extraordinary? Reach out and let's start a conversation about your next project.
        </p>
        <button className="px-8 py-4 bg-white text-mersi-dark text-sm">Get in Touch</button>
      </section>
    </div>
  );
}
