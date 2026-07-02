import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { supabase } from '@/lib/supabase';
import {
  subscribe,
  type NewsletterClient,
  type SubscribeResult,
} from './newsletter-actions';
import {
  TextStaggerHover,
  TextStaggerHoverActive,
  TextStaggerHoverHidden,
} from '@/components/ui/text-stagger-hover';
import { useIsMobile } from '@/hooks/use-mobile';
import { scaleForMobile } from '@/lib/motion-scale';

gsap.registerPlugin(ScrollTrigger);

type Status = 'idle' | 'submitting' | 'success' | 'error';

interface NewsletterState {
  status: Status;
  alreadySubscribed: boolean;
}

export function FinalReflectionCta() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<NewsletterState>({
    status: 'idle',
    alreadySubscribed: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    // Mobile shortens duration + scrub via MOBILE_TIME_SCALE per spec
    // Decision 14 — snappier reveal on phones.
    const ctx = gsap.context(() => {
      gsap.fromTo(
        section,
        { opacity: 0, y: 30, filter: 'blur(8px)' },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          ease: 'power2.out',
          duration: scaleForMobile(1, isMobile),
          scrollTrigger: {
            trigger: section,
            start: 'top 90%',
            end: 'top 30%',
            scrub: scaleForMobile(5, isMobile),
            invalidateOnRefresh: true,
          },
        },
      );
    }, section);

    return () => ctx.revert();
  }, [isMobile]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state.status === 'submitting') return;
    setState({ status: 'submitting', alreadySubscribed: false });
    const result: SubscribeResult = await subscribe({
      email,
      source: 'home-final-cta',
      // Supabase's PostgrestFilterBuilder is thenable but not structurally
      // a Promise; the runtime shape matches NewsletterClient so we narrow it
      // here at the boundary.
      client: supabase as unknown as NewsletterClient | null,
    });
    if (result.kind === 'success') {
      setState({ status: 'success', alreadySubscribed: result.alreadySubscribed });
      return;
    }
    setState({ status: 'error', alreadySubscribed: false });
    // Refocus the input so the user can correct and retry.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <section
      ref={sectionRef}
      className="final-reflection-cta py-32 md:py-40 px-4 md:px-8"
      style={{ background: 'var(--app-bg)' }}
      aria-label="Final reflection"
    >
      <div className="max-w-[720px] mx-auto text-center">
        <p
          className="text-mersi-dark"
          style={{
            fontFamily: '"Cormorant Garamond", Georgia, serif',
            fontWeight: 400,
            fontStyle: 'italic',
            fontSize: 'clamp(28px, 4vw, 44px)',
            lineHeight: 1.22,
            margin: '0 0 14px',
          }}
        >
          God's been revealing things to you all along.
        </p>
        <p
          style={{
            fontFamily: '"Cormorant Garamond", Georgia, serif',
            fontWeight: 400,
            fontSize: 'clamp(18px, 2vw, 22px)',
            lineHeight: 1.45,
            color: 'hsl(var(--mersi-dark) / 0.72)',
            maxWidth: '600px',
            margin: '0 auto 28px',
          }}
        >
          In the verses you underlined, the prayers you wrote. Add your notes and journals here and see what He's been revealing about you — to you.
        </p>
        <Link
          to="/notebook/notes"
          aria-label="Open your notebook"
          className="final-reflection-notepad-cta group inline-flex items-center justify-center gap-2 px-6 md:px-8 py-3.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 max-w-[70vw] md:max-w-none"
          style={{
            fontFamily: '"Cormorant Garamond", Georgia, serif',
            fontStyle: 'italic',
            fontWeight: 300,
            fontSize: '18px',
            color: 'hsl(var(--mersi-dark) / 0.95)',
            border: '1px solid hsl(var(--mersi-dark) / 0.30)',
            background: 'hsl(var(--mersi-dark) / 0.05)',
            textDecoration: 'none',
          }}
        >
          <TextStaggerHover as="span">
            <TextStaggerHoverActive animation="blur">Open your notebook</TextStaggerHoverActive>
            <TextStaggerHoverHidden animation="blur">Open your notebook</TextStaggerHoverHidden>
          </TextStaggerHover>
          <span
            aria-hidden="true"
            className="transition-transform duration-200 group-hover:translate-x-[3px] motion-reduce:transform-none"
          >
            →
          </span>
        </Link>

        <div
          className="final-reflection-newsletter flex flex-col items-center gap-4"
          style={{
            marginTop: '48px',
            paddingTop: '24px',
            borderTop: '1px solid hsl(var(--mersi-dark) / 0.22)',
          }}
        >
          <p
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: '12px',
              lineHeight: 1.5,
              color: 'hsl(var(--mersi-dark) / 0.7)',
              margin: 0,
              maxWidth: '420px',
            }}
          >
            Subscribe to our newsletter for more devotions and deep dives into God's word.
          </p>

          <div className="w-full max-w-[420px]" aria-live="polite">
            {state.status === 'success' ? (
              <p
                style={{
                  fontFamily: '"Cormorant Garamond", Georgia, serif',
                  fontStyle: 'italic',
                  fontSize: '16px',
                  color: 'hsl(var(--mersi-dark) / 0.78)',
                  margin: 0,
                }}
              >
                {state.alreadySubscribed
                  ? "You're already in."
                  : 'Thanks — keep an eye on your inbox.'}
              </p>
            ) : (
              <>
                <form
                  className="final-reflection-form flex items-center gap-2"
                  aria-label="Newsletter subscription"
                  style={{
                    borderBottom: '1px solid hsl(var(--mersi-dark) / 0.22)',
                    paddingBottom: '8px',
                    transition: 'border-color 200ms ease-out',
                  }}
                  onSubmit={handleSubmit}
                >
                  <label htmlFor="newsletter-email" className="sr-only">
                    Email address
                  </label>
                  <input
                    id="newsletter-email"
                    ref={inputRef}
                    type="email"
                    name="email"
                    required
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={state.status === 'submitting'}
                    className="flex-1 bg-transparent border-0 outline-0 disabled:opacity-50"
                    style={{
                      fontFamily: 'Inter, system-ui, sans-serif',
                      fontSize: '13px',
                      color: 'hsl(var(--mersi-dark) / 0.85)',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={state.status === 'submitting'}
                    style={{
                      fontFamily: 'Inter, system-ui, sans-serif',
                      fontSize: '10px',
                      letterSpacing: '0.24em',
                      padding: '8px 14px',
                      border: '1px solid hsl(var(--mersi-dark))',
                      background: 'transparent',
                      color: 'hsl(var(--mersi-dark))',
                      textTransform: 'uppercase',
                      cursor: state.status === 'submitting' ? 'not-allowed' : 'pointer',
                      opacity: state.status === 'submitting' ? 0.5 : 1,
                    }}
                  >
                    {state.status === 'submitting' ? (
                      '…'
                    ) : (
                      <TextStaggerHover as="span">
                        <TextStaggerHoverActive animation="blur">Subscribe</TextStaggerHoverActive>
                        <TextStaggerHoverHidden animation="blur">Subscribe</TextStaggerHoverHidden>
                      </TextStaggerHover>
                    )}
                  </button>
                </form>
                {state.status === 'error' && (
                  <p
                    style={{
                      marginTop: '8px',
                      fontFamily: 'Inter, system-ui, sans-serif',
                      fontSize: '11px',
                      color: 'hsl(var(--mersi-orange))',
                    }}
                  >
                    Try that again?
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
