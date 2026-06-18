// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewSubfolderDialog } from './NewSubfolderDialog';

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(cleanup);

describe('NewSubfolderDialog', () => {
  it('shows the parent name and creates a subfolder with name + defaults', async () => {
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();
    render(<NewSubfolderDialog open onOpenChange={onOpenChange} parentName="Study" onCreate={onCreate} />);

    expect(screen.getByText('New Subfolder')).toBeInTheDocument();
    // Parent context is surfaced ("Inside Study")
    expect(screen.getByText('Study')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/word studies/i), 'Word studies');
    await userEvent.click(screen.getByRole('button', { name: /create subfolder/i }));

    expect(onCreate).toHaveBeenCalledWith('Word studies', 'book', expect.any(String));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables Create until a name is entered', () => {
    render(<NewSubfolderDialog open onOpenChange={vi.fn()} parentName="Study" onCreate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create subfolder/i })).toBeDisabled();
  });
});
