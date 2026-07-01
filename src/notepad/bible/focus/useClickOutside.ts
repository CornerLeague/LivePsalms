import { useEffect, type RefObject } from 'react';

/**
 * Invoke `onOutside` when a pointerdown lands outside `ref`, while `active`.
 * `pointerdown` fires for both mouse clicks (desktop) and touches (mobile), so a
 * click OR tap anywhere outside dismisses. No listener is attached when inactive.
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  onOutside: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onOutside();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [ref, active, onOutside]);
}
