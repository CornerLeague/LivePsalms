// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// useIsMobile reads matchMedia — stub it (desktop).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }),
});

import { FocusListSwitcher } from './FocusListSwitcher';
import { QUICK_LIST_ID, type FocusList } from './focus-list-types';

const quick: FocusList = { id: QUICK_LIST_ID, title: 'Quick list', position: -1, items: [] };
const saved: FocusList[] = [
  { id: 'list-1', title: 'Comfort', position: 0, items: [] },
  { id: 'list-2', title: 'Romans', position: 1, items: [] },
];

function makeProps(over: Partial<React.ComponentProps<typeof FocusListSwitcher>> = {}) {
  return {
    savedLists: saved,
    quickList: quick,
    activeListId: 'list-1',
    canSave: true,
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onSaveQuick: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    ...over,
  };
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(cleanup);

describe('FocusListSwitcher', () => {
  it('opens the panel and renders saved list names + the quick list', () => {
    render(<FocusListSwitcher {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Comfort/ })); // the toggle shows the active title
    expect(screen.getByRole('button', { name: /^Romans$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quick list \(unsaved\)/ })).toBeInTheDocument();
  });

  it('selecting a saved list calls onSelect with its id', () => {
    const props = makeProps();
    render(<FocusListSwitcher {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Comfort/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Romans$/ }));
    expect(props.onSelect).toHaveBeenCalledWith('list-2');
  });

  it('shows rename and delete controls per saved list without any edit-mode toggle', () => {
    const props = makeProps();
    render(<FocusListSwitcher {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Comfort/ }));
    expect(screen.getByRole('button', { name: /Rename Comfort/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rename Romans/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete Comfort/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete Romans/ })).toBeInTheDocument();
  });

  it('"New list…" opens the modal and Save calls onNew with trimmed name', () => {
    const props = makeProps();
    render(<FocusListSwitcher {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Comfort/ }));
    fireEvent.click(screen.getByRole('button', { name: /New list/ }));
    expect(screen.getByLabelText('List name')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: '  Sunday AM  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(props.onNew).toHaveBeenCalledWith('Sunday AM');
  });

  it('clicking rename opens the modal prefilled; editing + Save calls onRename', () => {
    const props = makeProps();
    render(<FocusListSwitcher {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Comfort/ }));
    fireEvent.click(screen.getByRole('button', { name: /Rename Comfort/ }));
    expect(screen.getByLabelText('List name')).toHaveValue('Comfort');
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'New Name' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(props.onRename).toHaveBeenCalledWith('list-1', 'New Name');
  });

  it('clicking delete calls onDelete with the list id', () => {
    const props = makeProps();
    render(<FocusListSwitcher {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Comfort/ }));
    fireEvent.click(screen.getByRole('button', { name: /Delete Romans/ }));
    expect(props.onDelete).toHaveBeenCalledWith('list-2');
  });

  it('offers Save when the Quick list is active, savable, and non-empty', () => {
    const props = makeProps({
      activeListId: QUICK_LIST_ID,
      quickList: { ...quick, items: [{ id: 'i', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16', position: 0 }] },
    });
    render(<FocusListSwitcher {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Quick list/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save this list/ }));
    expect(screen.getByLabelText('List name')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Sunday AM' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(props.onSaveQuick).toHaveBeenCalledWith('Sunday AM');
  });
});
