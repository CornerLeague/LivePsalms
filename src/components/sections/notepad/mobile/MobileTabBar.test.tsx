// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileTabBar } from './MobileTabBar';

afterEach(cleanup);

describe('<MobileTabBar />', () => {
  it('renders Notes, Editor, Bible, More (no Lamplight) and marks the active one', () => {
    const { getByRole, queryByRole } = render(
      <MobileTabBar active="editor" onSelect={() => {}} onReflections={() => {}} />,
    );
    expect(getByRole('tab', { name: /Notes/ })).toBeTruthy();
    expect(getByRole('tab', { name: /Editor/ }).getAttribute('aria-selected')).toBe('true');
    expect(getByRole('tab', { name: /Bible/ })).toBeTruthy();
    expect(getByRole('tab', { name: /More/ })).toBeTruthy();
    expect(queryByRole('tab', { name: /Lamplight/ })).toBeNull();
  });

  it('calls onSelect with the tab id when a tab is tapped', () => {
    const onSelect = vi.fn();
    const { getByRole } = render(
      <MobileTabBar active="notes" onSelect={onSelect} onReflections={() => {}} />,
    );
    fireEvent.click(getByRole('tab', { name: /Bible/ }));
    expect(onSelect).toHaveBeenCalledWith('bible');
  });

  it('renders Reflections as a raised launcher (a button, not a tab) and fires onReflections', () => {
    const onReflections = vi.fn();
    const onSelect = vi.fn();
    const { getByRole, queryByRole } = render(
      <MobileTabBar active="notes" onSelect={onSelect} onReflections={onReflections} />,
    );
    // It's a launcher into the full path page, not an in-shell tab.
    expect(queryByRole('tab', { name: /Reflections/ })).toBeNull();
    const launcher = getByRole('button', { name: /Reflections/ });
    fireEvent.click(launcher);
    expect(onReflections).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('never renders the lamplight connection dot in the bar (it moved to the header)', () => {
    const { container } = render(
      <MobileTabBar active="notes" onSelect={() => {}} onReflections={() => {}} />,
    );
    expect(container.querySelector('[data-testid="lamplight-dot"]')).toBeNull();
  });
});
