// @vitest-environment jsdom
// src/notepad/onboarding/checklist/ChecklistPanel.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ChecklistPanel } from './ChecklistPanel';
import { GET_STARTED_ITEMS } from './get-started-items';

afterEach(cleanup);

const base = {
  title: 'Get started',
  items: GET_STARTED_ITEMS,
  completed: { 'write-first-note': true },
  collapsed: false,
  onToggleCollapsed: vi.fn(),
  onDismiss: vi.fn(),
};

describe('ChecklistPanel', () => {
  it('renders all items and marks completed ones', () => {
    render(<ChecklistPanel {...base} />);
    expect(screen.getByText('Write your first note')).toBeInTheDocument();
    expect(screen.getByText('Link a verse')).toBeInTheDocument();
    // completed item exposes an accessible checked state
    expect(screen.getByRole('checkbox', { name: /write your first note/i })).toBeChecked();
  });

  it('collapsed renders a pill, not the full list', () => {
    render(<ChecklistPanel {...base} collapsed />);
    expect(screen.queryByText('Link a verse')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
  });

  it('dismiss and collapse fire their callbacks', () => {
    const onDismiss = vi.fn();
    const onToggleCollapsed = vi.fn();
    render(<ChecklistPanel {...base} onDismiss={onDismiss} onToggleCollapsed={onToggleCollapsed} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    fireEvent.click(screen.getByRole('button', { name: /collapse/i }));
    expect(onDismiss).toHaveBeenCalled();
    expect(onToggleCollapsed).toHaveBeenCalled();
  });

  it('has no replay-tour affordance — replay lives in the header TourReplayButton', () => {
    render(<ChecklistPanel {...base} />);
    expect(screen.queryByRole('button', { name: /replay/i })).not.toBeInTheDocument();
  });
});
