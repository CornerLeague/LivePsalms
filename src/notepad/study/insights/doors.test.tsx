// @vitest-environment jsdom
// src/notepad/study/insights/doors.test.tsx
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }));

import { referenceDoor, passageDoor, type DoorDeps } from './doors';

const deps: DoorDeps = {
  translation: 'BSB',
  userId: 'u1',
  adapter: null,
  canGenerate: true,
};

describe('the Insights door registry', () => {
  it('registers The Passage ahead of Sources & Reference — door order is reading order', () => {
    expect([passageDoor(deps).id, referenceDoor(deps).id]).toEqual(['passage', 'reference']);
  });

  it('gives every door a label and a blurb, which the chooser renders', () => {
    // With more than one door the overlay's chooser wakes up, and a door with
    // no blurb becomes an unexplained button.
    for (const door of [passageDoor(deps), referenceDoor(deps)]) {
      expect(door.label.length).toBeGreaterThan(0);
      expect(door.blurb.length).toBeGreaterThan(0);
    }
  });

  it('names the four sections in the Passage door’s blurb, in reading order', () => {
    // The blurb is the only thing a reader sees before opening the door.
    const blurb = passageDoor(deps).blurb;
    const order = ['doing', 'either side', 'shape of the chapter', 'lands'];
    let cursor = -1;
    for (const phrase of order) {
      const at = blurb.indexOf(phrase);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
  });
});
