// @vitest-environment jsdom
// src/notepad/study/insights/LibraryVoices.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LibraryVoices } from './LibraryVoices';
import type { LibraryVoice } from './useLibraryVoices';

afterEach(cleanup);

const spurgeon: LibraryVoice = {
  chunkId: 'c1', sourceId: 'treasury-of-david',
  sourceLabel: 'The Treasury of David · Charles H. Spurgeon, 1869–1885',
  tradition: 'Baptist (Reformed)', heading: 'Psalm 27:4',
  content: 'One thing have I desired — a holy singleness of aim.',
};
const henry: LibraryVoice = {
  chunkId: 'c2', sourceId: 'matthew-henry-concise',
  sourceLabel: 'Matthew Henry’s Concise Commentary · Matthew Henry, 1706–1710',
  tradition: 'Nonconformist', heading: 'Psalm 27:1-6',
  content: 'David professes his faith and holy desire.',
};

describe('LibraryVoices', () => {
  it('renders nothing at all when no voice covers the passage', () => {
    const { container } = render(<LibraryVoices voices={[]} loading={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while loading rather than a flashing placeholder', () => {
    const { container } = render(<LibraryVoices voices={[]} loading />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the source and the passage it comments on', () => {
    render(<LibraryVoices voices={[spurgeon]} loading={false} />);
    expect(screen.getByText(/The Treasury of David · Charles H. Spurgeon, 1869–1885/)).toBeTruthy();
    expect(screen.getByText('Psalm 27:4')).toBeTruthy();
  });

  it('keeps the excerpt collapsed until the reader opens it', () => {
    render(<LibraryVoices voices={[spurgeon]} loading={false} />);
    expect(screen.queryByText(/holy singleness of aim/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Treasury of David/ }));
    expect(screen.getByText(/holy singleness of aim/)).toBeTruthy();
  });

  it('expands each voice independently', () => {
    render(<LibraryVoices voices={[spurgeon, henry]} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Treasury of David/ }));

    expect(screen.getByText(/holy singleness of aim/)).toBeTruthy();
    expect(screen.queryByText(/professes his faith/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Matthew Henry/ }));
    expect(screen.getByText(/holy singleness of aim/)).toBeTruthy();
    expect(screen.getByText(/professes his faith/)).toBeTruthy();
  });

  it('collapses again on a second click', () => {
    render(<LibraryVoices voices={[spurgeon]} loading={false} />);
    const toggle = screen.getByRole('button', { name: /Treasury of David/ });

    fireEvent.click(toggle);
    expect(screen.getByText(/holy singleness of aim/)).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText(/holy singleness of aim/)).toBeNull();
  });

  it('reports aria-expanded so the collapse is legible to assistive tech', () => {
    render(<LibraryVoices voices={[spurgeon]} loading={false} />);
    const toggle = screen.getByRole('button', { name: /Treasury of David/ });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('states coverage from the traditions actually present, never a hardcoded list', () => {
    const { container } = render(<LibraryVoices voices={[spurgeon, henry]} loading={false} />);

    expect(container.textContent).toContain('Baptist (Reformed)');
    expect(container.textContent).toContain('Nonconformist');
    // Traditions we hold no corpus for must not be implied as represented.
    expect(container.textContent).not.toMatch(/Orthodox|Catholic|Jewish|Church Fathers/);
  });

  it('lists each tradition once even when several voices share it', () => {
    const alsoBaptist = { ...spurgeon, chunkId: 'c3', sourceId: 'other', sourceLabel: 'Another Work · Someone, 1900' };
    const { container } = render(<LibraryVoices voices={[spurgeon, alsoBaptist]} loading={false} />);

    expect(container.textContent!.match(/Baptist \(Reformed\)/g)).toHaveLength(1);
  });
});
