// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getNotes = vi.fn();
const start = vi.fn();
const decline = vi.fn();
const dismissError = vi.fn();
let workflowState: { status: string } = { status: 'idle' };

vi.mock('../storage/local-storage', () => ({
  localAdapter: { getNotes: () => getNotes() },
}));
vi.mock('../storage/useMigrationWorkflow', () => ({
  useMigrationWorkflow: () => ({ state: workflowState, start, decline, dismissError }),
}));

import { MigrationDialog } from './MigrationDialog';
import type { StorageAdapter } from '../storage/adapter';

const targetAdapter = {} as StorageAdapter;
const note = (title: string) => ({ title }) as { title: string };

beforeEach(() => {
  workflowState = { status: 'idle' };
  getNotes.mockReset();
  start.mockReset();
  decline.mockReset();
  dismissError.mockReset();
});
afterEach(cleanup);

function renderDialog(onClose = vi.fn()) {
  render(
    <MigrationDialog
      open
      onClose={onClose}
      targetAdapter={targetAdapter}
      onMigrationComplete={vi.fn()}
    />,
  );
  return onClose;
}

describe('MigrationDialog — title list', () => {
  it('lists the first three titles and summarises the rest', async () => {
    getNotes.mockResolvedValue(
      ['Morning prayer', 'Romans 8 reflections', 'Sermon notes', 'Psalm 23', 'Gratitude'].map(note),
    );
    renderDialog();
    expect(await screen.findByText('Import these 5 notes?')).toBeTruthy();
    expect(screen.getByText('Morning prayer')).toBeTruthy();
    expect(screen.getByText('Romans 8 reflections')).toBeTruthy();
    expect(screen.getByText('Sermon notes')).toBeTruthy();
    expect(screen.getByText('…and 2 more')).toBeTruthy();
    expect(screen.queryByText('Psalm 23')).toBeNull();
  });

  it('uses singular copy for a single note', async () => {
    getNotes.mockResolvedValue([note('Just one thought')]);
    renderDialog();
    expect(await screen.findByText('Import this note?')).toBeTruthy();
    expect(screen.getByText('Just one thought')).toBeTruthy();
  });

  it('renders whitespace-only titles as "Untitled note"', async () => {
    getNotes.mockResolvedValue([note('   '), note('Real title')]);
    renderDialog();
    expect(await screen.findByText('Import these 2 notes?')).toBeTruthy();
    expect(screen.getByText('Untitled note')).toBeTruthy();
  });

  it('calls start when Import Notes is clicked', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    renderDialog();
    fireEvent.click(await screen.findByText('Import Notes'));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('exposes an accessible description on the prompt for screen readers', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    renderDialog();
    expect(await screen.findByText('Import this note?')).toBeTruthy();
    expect(
      screen.getByText('Choose whether to import these notes to your account or permanently delete them.'),
    ).toBeTruthy();
  });
});

describe('MigrationDialog — confirm-decline', () => {
  it('shows the delete confirmation when No is clicked', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    renderDialog();
    fireEvent.click(await screen.findByText('No'));
    expect(screen.getByText('Delete these notes?')).toBeTruthy();
    expect(screen.getByText(/permanently deleted/i)).toBeTruthy();
  });

  it('returns to the prompt when Keep is clicked, without deleting', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    const onClose = renderDialog();
    fireEvent.click(await screen.findByText('No'));
    fireEvent.click(screen.getByText('Keep'));
    expect(screen.getByText('Import this note?')).toBeTruthy();
    expect(decline).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls decline when Delete is confirmed', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    renderDialog();
    fireEvent.click(await screen.findByText('No'));
    fireEvent.click(screen.getByText('Delete'));
    expect(decline).toHaveBeenCalledTimes(1);
  });

  it('clicking No does not delete or close on its own', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    const onClose = renderDialog();
    fireEvent.click(await screen.findByText('No'));
    expect(decline).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('resets to the prompt view when reopened', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    const { rerender } = render(
      <MigrationDialog open onClose={vi.fn()} targetAdapter={targetAdapter} onMigrationComplete={vi.fn()} />,
    );
    fireEvent.click(await screen.findByText('No'));
    expect(screen.getByText('Delete these notes?')).toBeTruthy();
    rerender(
      <MigrationDialog open={false} onClose={vi.fn()} targetAdapter={targetAdapter} onMigrationComplete={vi.fn()} />,
    );
    rerender(
      <MigrationDialog open onClose={vi.fn()} targetAdapter={targetAdapter} onMigrationComplete={vi.fn()} />,
    );
    expect(await screen.findByText('Import this note?')).toBeTruthy();
  });
});
