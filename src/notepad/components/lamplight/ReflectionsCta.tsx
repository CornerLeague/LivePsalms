import { Link } from 'react-router-dom';

export interface ReflectionsCtaProps {
  href: string;
}

/** Filled "Your Reflections" nav CTA. Exactly one instance is visible at a time;
 *  placement (idle: under "Show Me Today's Lamp"; revealed: panel bottom) is the caller's call. */
export function ReflectionsCta({ href }: ReflectionsCtaProps) {
  return (
    <Link
      to={href}
      className="px-5 py-2.5 rounded-full text-sm cursor-pointer"
      style={{
        background: 'var(--reflections-cta-bg)',
        color: 'var(--reflections-cta-fg)',
        fontFamily: 'Outfit, sans-serif',
        textDecoration: 'none',
      }}
    >
      Your Reflections
    </Link>
  );
}
