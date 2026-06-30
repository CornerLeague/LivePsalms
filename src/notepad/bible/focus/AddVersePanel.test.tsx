// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AddVersePanel } from './AddVersePanel';
import type { VerseSearchDeps, RawFtsRow } from '../verse-search-types';

afterEach(cleanup);

// A deps stub whose FTS path returns one John 3:16 row; the rest are inert.
function depsWithFts(rows: RawFtsRow[]): VerseSearchDeps {
  return {
    ftsSearch: async () => rows,
    semanticSearch: async () => [],
    resolvePericope: async () => null,
    fetchVerseText: async () => null,
  };
}

describe('AddVersePanel — type / paste', () => {
  it('parses a pasted batch and calls onAddRefs with the parsed refs', () => {
    const onAddRefs = vi.fn();
    render(<AddVersePanel onAddRefs={onAddRefs} searchDeps={depsWithFts([])} translation="BSB" />);
    fireEvent.change(screen.getByLabelText(/paste references/i), {
      target: { value: 'John 3:16, Eph 2:8' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(onAddRefs).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' },
      { book: 'eph', chapter: 2, verseStart: 8, verseEnd: 8, label: 'Ephesians 2:8' },
    ]);
  });

  it('reports the unparseable fragments and still adds the rest', () => {
    const onAddRefs = vi.fn();
    render(<AddVersePanel onAddRefs={onAddRefs} searchDeps={depsWithFts([])} translation="BSB" />);
    fireEvent.change(screen.getByLabelText(/paste references/i), {
      target: { value: 'John 3:16, gibberish' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(onAddRefs).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' },
    ]);
    expect(screen.getByText(/Couldn.t read:/i)).toHaveTextContent('gibberish');
  });
});

describe('AddVersePanel — search', () => {
  it('adds a tapped search result as a ScriptureRef', async () => {
    const onAddRefs = vi.fn();
    const deps = depsWithFts([
      { id: 'jhn.3.16', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: null, text: 'For God so loved the world' },
    ]);
    render(<AddVersePanel onAddRefs={onAddRefs} searchDeps={deps} translation="BSB" />);
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    fireEvent.change(screen.getByLabelText(/search verses/i), { target: { value: 'loved' } });

    const result = await screen.findByRole('button', { name: /John 3:16/ });
    fireEvent.click(result);
    expect(onAddRefs).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' },
    ]);
  });
});
