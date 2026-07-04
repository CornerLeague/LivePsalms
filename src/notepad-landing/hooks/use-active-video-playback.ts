import { useEffect, type RefObject } from 'react';

/**
 * Drive a garden-station video from its `isActive` flag: play while the station
 * is the active one (motion allowed), pause + rewind otherwise. Extracted so the
 * subtle autoplay-hardening below lives in one place across every station.
 */
export function useActiveVideoPlayback(
  ref: RefObject<HTMLVideoElement | null>,
  isActive: boolean,
  prm: boolean,
): void {
  useEffect(() => {
    const v = ref.current;
    if (!v) return;

    // Paused states: reduced motion, or this station isn't the active one.
    if (prm || !isActive) {
      v.pause();
      if (!isActive) v.currentTime = 0;
      return;
    }

    // Active + motion allowed. A lone play() can be interrupted by the rapid
    // isActive churn at station boundaries during a scroll: its promise rejects
    // and, because the effect won't re-run while isActive stays true, the clip
    // is left paused even once the station settles (seen on mobile). Re-assert
    // playback each frame until it sticks — bounded so a genuine autoplay block
    // (e.g. iOS low-power mode) can't spin forever; the poster stays instead.
    let cancelled = false;
    let raf = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 90; // ~1.5s at 60fps — long enough to outlast churn
    const ensurePlaying = () => {
      if (cancelled || !v.paused || attempts++ >= MAX_ATTEMPTS) return;
      v.play().catch(() => {
        if (!cancelled) raf = requestAnimationFrame(ensurePlaying);
      });
    };
    ensurePlaying();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, isActive, prm]);
}
