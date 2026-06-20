// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/notepad/bible/BibleReader', () => ({
  BibleReader: (props: { initialBook: string; initialChapter: number }) =>
    <div>reader {props.initialBook}:{props.initialChapter}</div>,
}));
import { StudyReader } from './StudyReader';

describe('StudyReader', () => {
  it('renders the BibleReader seeded with the open passage', () => {
    render(<StudyReader book="rom" chapter={8} onPassageChange={() => {}} />);
    expect(screen.getByText('reader rom:8')).toBeTruthy();
  });
});
