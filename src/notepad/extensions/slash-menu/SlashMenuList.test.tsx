// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { SlashMenuList } from './SlashMenuList';
import { createSlashCommands } from './slash-commands';

afterEach(() => cleanup());

const COMMANDS = createSlashCommands({ defaultSwatchId: 'highlight-01' });

function renderList(onSelect = vi.fn()) {
  const utils = render(
    <SlashMenuList items={COMMANDS} selectedIndex={0} onSelect={onSelect} grouped mobile />,
  );
  const row = (title: string) => {
    const el = utils.getByText(title).closest('[role="option"]');
    if (!el) throw new Error(`row ${title} not found`);
    return el as HTMLElement;
  };
  return { ...utils, onSelect, row };
}

const touch = (x = 50, y = 50, pointerId = 7) =>
  ({ pointerType: 'touch', pointerId, clientX: x, clientY: y, bubbles: true, cancelable: true }) as const;
const mouse = (x = 50, y = 50) =>
  ({ pointerType: 'mouse', pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }) as const;

describe('SlashMenuList touch selection', () => {
  it('does NOT select on touch pointerdown (finger contact is not a choice)', () => {
    const { onSelect, row } = renderList();
    fireEvent.pointerDown(row('Heading 1'), touch());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects on a clean touch tap (down → up in place)', () => {
    const { onSelect, row } = renderList();
    const target = row('Heading 1');
    fireEvent.pointerDown(target, touch(50, 50));
    fireEvent.pointerUp(target, touch(52, 53));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('heading-1');
  });

  it('a drag past the slop (list scroll) never selects', () => {
    const { onSelect, row } = renderList();
    const target = row('Heading 1');
    fireEvent.pointerDown(target, touch(50, 50));
    fireEvent.pointerUp(target, touch(50, 90));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('pointercancel (browser claims the gesture) disarms the press', () => {
    const { onSelect, row } = renderList();
    const target = row('Heading 1');
    fireEvent.pointerDown(target, touch(50, 50));
    fireEvent.pointerCancel(target, touch(50, 50));
    fireEvent.pointerUp(target, touch(50, 50));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a release on a DIFFERENT row than the press selects nothing', () => {
    const { onSelect, row } = renderList();
    fireEvent.pointerDown(row('Heading 1'), touch(50, 50));
    fireEvent.pointerUp(row('Heading 2'), touch(50, 52));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('mouse keeps select-on-press (beats the blur/unmount race)', () => {
    const { onSelect, row } = renderList();
    fireEvent.pointerDown(row('Quote'), mouse());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('quote');
  });

  it('any press inside the menu cancels the default (keeps the editor focused)', () => {
    const { row } = renderList();
    const down = new window.PointerEvent('pointerdown', touch());
    row('Heading 1').dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });
});
