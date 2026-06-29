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
});
