// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StudyTabBar } from './StudyTabBar';

afterEach(cleanup);

describe('StudyTabBar', () => {
  it('renders Reader, Study, and Context tabs and marks the active one', () => {
    render(<StudyTabBar active="reader" onSelect={() => {}} />);
    expect(screen.getByRole('tab', { name: /reader/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /study/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /context/i })).toBeInTheDocument();
  });

  it('orders the sub-tabs Study, Reader, Context so Reader sits in the center', () => {
    render(<StudyTabBar active="reader" onSelect={() => {}} />);
    const labels = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(labels).toEqual(['Study', 'Reader', 'Context']);
  });

  it('calls onSelect with the tapped tab id', () => {
    const onSelect = vi.fn();
    render(<StudyTabBar active="reader" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: /context/i }));
    expect(onSelect).toHaveBeenCalledWith('context');
  });
});
