// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileTabBar } from './MobileTabBar';

afterEach(cleanup);

describe('<MobileTabBar />', () => {
  it('renders Notes, Editor, Bible, More (no Lamplight) and marks the active one', () => {
    const { getByRole, queryByRole } = render(
      <MobileTabBar active="editor" onSelect={() => {}} />,
    );
    expect(getByRole('tab', { name: /Notes/ })).toBeTruthy();
    expect(getByRole('tab', { name: /Editor/ }).getAttribute('aria-selected')).toBe('true');
    expect(getByRole('tab', { name: /Bible/ })).toBeTruthy();
    expect(getByRole('tab', { name: /More/ })).toBeTruthy();
    expect(queryByRole('tab', { name: /Lamplight/ })).toBeNull();
  });

  it('calls onSelect with the tab id when a tab is tapped', () => {
    const onSelect = vi.fn();
    const { getByRole } = render(<MobileTabBar active="notes" onSelect={onSelect} />);
    fireEvent.click(getByRole('tab', { name: /Bible/ }));
    expect(onSelect).toHaveBeenCalledWith('bible');
  });

  it('never renders the lamplight connection dot in the bar (it moved to the header)', () => {
    const { container } = render(<MobileTabBar active="notes" onSelect={() => {}} />);
    expect(container.querySelector('[data-testid="lamplight-dot"]')).toBeNull();
  });
});
