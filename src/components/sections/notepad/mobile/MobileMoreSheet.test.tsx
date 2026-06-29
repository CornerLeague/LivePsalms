// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/notepad/bible/BibleStudyPane', () => ({ BibleStudyPane: () => <div data-testid="bible-study">bible</div> }));
vi.mock('../../../../notepad/components/BacklinksPanel', () => ({ BacklinksPanel: () => <div data-testid="backlinks" /> }));
vi.mock('../../../../notepad/components/InfoPanel', () => ({ InfoPanel: () => <div data-testid="info" /> }));
vi.mock('../../../../notepad/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../../../notepad/context/useNoteCollection', () => ({ useNoteCollection: () => ({ notes: [] }) }));
vi.mock('../../../../notepad/context/useReferenceGraph', () => ({ useReferenceGraph: () => ({ graph: {} }) }));

// GraphPane mock exposes a button that fires onNodePeek (simulating a node tap).
vi.mock('../GraphPane', () => ({
  GraphPane: (props: { onNodePeek: (n: { id: string; type: string; title: string }) => void }) => (
    <button data-testid="graph" onClick={() => props.onNodePeek({ id: 'n1', type: 'devotion', title: 'N1' })}>graph</button>
  ),
}));

// buildPeekData mock returns a minimal PeekData for the tapped target.
vi.mock('./node-peek-data', () => ({
  buildPeekData: (t: { id: string; kind: 'note' | 'scripture' }) => ({
    kind: t.kind, id: t.id, title: 'N1', noteType: 'devotion', connectionCount: 0,
    preview: '', linkedVerses: [], reference: '', translation: '', text: '', referencedBy: [],
  }),
}));

// NodePeek mock surfaces the callbacks as buttons.
vi.mock('./NodePeek', () => ({
  NodePeek: (props: { data: { id: string }; onBack: () => void; onOpenInEditor: (id: string) => void; onFocus: (id: string) => void; onPeekNote: (id: string) => void }) => (
    <div data-testid="peek">
      <span data-testid="peek-id">{props.data.id}</span>
      <button data-testid="peek-open" onClick={() => props.onOpenInEditor(props.data.id)}>open</button>
      <button data-testid="peek-focus" onClick={() => props.onFocus(props.data.id)}>focus</button>
      <button data-testid="peek-back" onClick={props.onBack}>back</button>
      <button data-testid="peek-repeek" onClick={() => props.onPeekNote('n2')}>repeek</button>
    </div>
  ),
}));

import { MobileMoreSheet } from './MobileMoreSheet';

afterEach(cleanup);

function open(extra: Partial<{ onClose: () => void; onOpenNote: (id: string) => void }> = {}) {
  return render(<MobileMoreSheet open onClose={extra.onClose ?? vi.fn()} onOpenNote={extra.onOpenNote ?? vi.fn()} />);
}

describe('<MobileMoreSheet />', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<MobileMoreSheet open={false} onClose={vi.fn()} onOpenNote={vi.fn()} />);
    expect(container.querySelector('[data-testid="backlinks"]')).toBeNull();
  });

  it('shows Backlinks by default and switches panels via the segmented control', () => {
    const { getByTestId, queryByTestId, getByRole } = open();
    expect(getByTestId('backlinks')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Graph' }));
    expect(getByTestId('graph')).toBeTruthy();
    expect(queryByTestId('backlinks')).toBeNull();
  });

  it('calls onClose when the backdrop is tapped', () => {
    const onClose = vi.fn();
    const { getByLabelText } = open({ onClose });
    fireEvent.click(getByLabelText('Close details'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('routes a graph node tap to the peek; Back returns to the graph', () => {
    const { getByRole, getByTestId, queryByTestId } = open();
    fireEvent.click(getByRole('button', { name: 'Graph' }));
    fireEvent.click(getByTestId('graph'));
    expect(getByTestId('peek')).toBeTruthy();
    expect(queryByTestId('graph')).toBeNull();
    fireEvent.click(getByTestId('peek-back'));
    expect(getByTestId('graph')).toBeTruthy();
  });

  it('Open in Editor calls onOpenNote and closes the sheet', () => {
    const onOpenNote = vi.fn(); const onClose = vi.fn();
    const { getByRole, getByTestId } = open({ onOpenNote, onClose });
    fireEvent.click(getByRole('button', { name: 'Graph' }));
    fireEvent.click(getByTestId('graph'));
    fireEvent.click(getByTestId('peek-open'));
    expect(onOpenNote).toHaveBeenCalledWith('n1');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Focus dismisses the peek back to the graph', () => {
    const { getByRole, getByTestId, queryByTestId } = open();
    fireEvent.click(getByRole('button', { name: 'Graph' }));
    fireEvent.click(getByTestId('graph'));
    fireEvent.click(getByTestId('peek-focus'));
    expect(getByTestId('graph')).toBeTruthy();
    expect(queryByTestId('peek')).toBeNull();
  });

  it('verse→note re-peek: tapping a referenced note re-targets the peek', () => {
    const { getByRole, getByTestId } = open();
    fireEvent.click(getByRole('button', { name: 'Graph' }));
    fireEvent.click(getByTestId('graph'));
    expect(getByTestId('peek-id').textContent).toBe('n1');
    fireEvent.click(getByTestId('peek-repeek'));
    expect(getByTestId('peek-id').textContent).toBe('n2');
  });

  it('switching segments away from Graph clears an open peek', () => {
    const { getByRole, getByTestId, queryByTestId } = open();
    fireEvent.click(getByRole('button', { name: 'Graph' }));
    fireEvent.click(getByTestId('graph'));
    expect(getByTestId('peek')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Info' }));
    fireEvent.click(getByRole('button', { name: 'Graph' }));
    expect(queryByTestId('peek')).toBeNull();
    expect(getByTestId('graph')).toBeTruthy();
  });

  it('no longer offers a Bible segment (Bible is a first-class tab now)', () => {
    const { queryByRole, queryByTestId, getByTestId } = open();
    expect(queryByRole('button', { name: 'Bible' })).toBeNull();
    expect(queryByTestId('bible-study')).toBeNull();
    expect(getByTestId('backlinks')).toBeTruthy(); // Backlinks / Info / Graph remain
  });
});
