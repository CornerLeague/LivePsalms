// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const bibleReaderProps = vi.fn();
vi.mock('@/notepad/bible/BibleReader', () => ({
  BibleReader: (props: Record<string, unknown>) => {
    bibleReaderProps(props);
    return <div>reader {String(props.initialBook)}:{String(props.initialChapter)}</div>;
  },
}));
vi.mock('@/notepad/bible/useBibleTranslation', () => ({
  useBibleTranslation: () => ({ translation: 'BSB', setTranslation: vi.fn() }),
}));
import { StudyReader } from './StudyReader';

beforeEach(() => bibleReaderProps.mockReset());

describe('StudyReader', () => {
  it('renders the BibleReader seeded with the open passage', () => {
    render(<StudyReader book="rom" chapter={8} onPassageChange={() => {}} />);
    expect(screen.getByText('reader rom:8')).toBeTruthy();
  });
});

describe('StudyReader onSelectVerse', () => {
  it('forwards onSelectVerse to BibleReader', () => {
    const onSelectVerse = vi.fn();
    render(<StudyReader book="jhn" chapter={3} onPassageChange={vi.fn()} onSelectVerse={onSelectVerse} />);
    const props = bibleReaderProps.mock.calls[0][0];
    expect(props.onSelectVerse).toBe(onSelectVerse);
  });
});
