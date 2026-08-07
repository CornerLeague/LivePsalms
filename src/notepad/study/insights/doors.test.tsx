// @vitest-environment jsdom
// src/notepad/study/insights/doors.test.tsx
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }));

import { referenceDoor, passageDoor, deeperDoor, type DoorDeps } from './doors';
import { INSIGHT_DOOR_VIEWS } from './insight-doors';

const deps: DoorDeps = {
  translation: 'BSB',
  userId: 'u1',
  adapter: null,
  canGenerate: true,
};

describe('the Insights door registry', () => {
  it('registers all three doors in reading order', () => {
    // The Passage, then Deeper In, then the free Sources & Reference. Door order
    // IS reading order — the chooser renders the array as given.
    expect([passageDoor(deps).id, deeperDoor(deps).id, referenceDoor(deps).id])
      .toEqual(['passage', 'deeper', 'reference']);
  });

  it('takes the generated doors’ ids and copy from the shared registry', () => {
    // Not retyped here: the id is the `door` column value and the cache key, and
    // a literal in two places is a literal that drifts.
    for (const view of INSIGHT_DOOR_VIEWS) {
      const door = view.id === 'passage' ? passageDoor(deps) : deeperDoor(deps);
      expect(door.id).toBe(view.id);
      expect(door.label).toBe(view.label);
    }
  });

  it('gives every door a label and a blurb, which the chooser renders', () => {
    // With more than one door the overlay's chooser wakes up, and a door with
    // no blurb becomes an unexplained button.
    for (const door of [passageDoor(deps), deeperDoor(deps), referenceDoor(deps)]) {
      expect(door.label.length).toBeGreaterThan(0);
      expect(door.blurb.length).toBeGreaterThan(0);
    }
  });

  it('names Deeper In’s four sections in its blurb, in reading order', () => {
    const blurb = deeperDoor(deps).blurb;
    const order = ['asks to be read', 'world it came out of', 'weight it carries', 'commonly misread'];
    let cursor = -1;
    for (const phrase of order) {
      const at = blurb.indexOf(phrase);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
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
