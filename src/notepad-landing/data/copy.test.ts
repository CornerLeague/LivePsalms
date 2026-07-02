import { describe, it, expect } from 'vitest';
import { copy } from './copy';

describe('notepad landing copy (locked)', () => {
  it('hero H1 is the locked line', () => {
    expect(copy.section01.h1).toBe('Your Walk with God isn’t just a Journey, it’s a Story.');
  });

  it('hero subtitle matches the locked copy', () => {
    expect(copy.section01.sub).toBe(
      'We have carefully crafted an all-in-one digital notebook made to empower your time with God.',
    );
  });

  it('hero CTA note reassures no-account / offline', () => {
    expect(copy.section01.ctaNote).toBe('No account needed to start. Works offline.');
  });

  it('primary CTA reads "Open your notebook →"', () => {
    expect(copy.section01.ctaPrimary).toBe('Open your notebook →');
  });

  it('closing CTA repeats the primary', () => {
    expect(copy.section09.ctaPrimary).toBe('Open your notebook →');
  });

  it('Lamplight section leads with the "already knows" framing', () => {
    expect(copy.section04.h2).toBe('Most apps wait for you to type. This one already knows.');
  });

  it('Lamplight shows its work (cites the source note and verse)', () => {
    expect(copy.section04.detail).toMatch(/names the note and the verse/);
  });

  it('section 6 (spiritual canvas) leads with the canvas framing', () => {
    expect(copy.section06.eyebrow).toBe('— SPIRITUAL CANVAS —');
    expect(copy.section06.h2).toBe('A page that actually looks like yours.');
  });
});
