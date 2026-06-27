// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const bibleReaderProps = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: null }));
vi.mock('@/notepad/bible/BibleReader', () => ({
  BibleReader: (props: Record<string, unknown>) => {
    bibleReaderProps(props);
    return <div>reader {String(props.initialBook)}:{String(props.initialChapter)}</div>;
  },
}));
vi.mock('@/notepad/bible/useBibleTranslation', () => ({
  useBibleTranslation: () => ({ translation: 'BSB', setTranslation: vi.fn() }),
}));
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: null }),
}));

import { StudyReader } from './StudyReader';
import { BiblePrefsProvider } from '@/notepad/bible/prefs/BiblePrefsProvider';

beforeEach(() => bibleReaderProps.mockReset());

describe('StudyReader', () => {
  it('renders the BibleReader seeded with the open passage', () => {
    render(
      <BiblePrefsProvider>
        <StudyReader book="rom" chapter={8} onPassageChange={() => {}} />
      </BiblePrefsProvider>,
    );
    expect(screen.getByText('reader rom:8')).toBeTruthy();
  });
});

describe('StudyReader onSelectVerse', () => {
  it('forwards onSelectVerse to BibleReader', () => {
    const onSelectVerse = vi.fn();
    render(
      <BiblePrefsProvider>
        <StudyReader book="jhn" chapter={3} onPassageChange={vi.fn()} onSelectVerse={onSelectVerse} />
      </BiblePrefsProvider>,
    );
    const props = bibleReaderProps.mock.calls[0][0];
    expect(props.onSelectVerse).toBe(onSelectVerse);
  });
});
