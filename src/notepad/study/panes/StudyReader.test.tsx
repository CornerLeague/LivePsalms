// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/notepad/bible/BibleReader', () => ({
  BibleReader: (props: { initialBook: string; initialChapter: number }) =>
    <div>reader {props.initialBook}:{props.initialChapter}</div>,
}));
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: null }),
}));
import { StudyReader } from './StudyReader';
import { BiblePrefsProvider } from '@/notepad/bible/prefs/BiblePrefsProvider';

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
