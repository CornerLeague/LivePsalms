// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { UsernameSetup } from './UsernameSetup';

afterEach(cleanup);

function setup(overrides: Partial<React.ComponentProps<typeof UsernameSetup>> = {}) {
  const checkAvailable = overrides.checkAvailable ?? vi.fn().mockResolvedValue(true);
  const claim = overrides.claim ?? vi.fn().mockResolvedValue({ ok: true });
  const onClaimed = overrides.onClaimed ?? vi.fn();
  render(
    <UsernameSetup
      checkAvailable={checkAvailable}
      claim={claim}
      onClaimed={onClaimed}
      debounceMs={0}
      {...overrides}
    />,
  );
  return { checkAvailable, claim, onClaimed };
}

describe('UsernameSetup', () => {
  it('gives the username input Pattern-A background/text tokens for dark-mode readability', () => {
    setup();
    const input = screen.getByRole('textbox');
    expect(input).toHaveStyle({ background: 'var(--plaster)', color: 'var(--deep-umber)' });
  });

  it('disables submit and shows a hint for too-short input', () => {
    setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ab' } });
    expect(screen.getByText(/at least 3/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /claim/i })).toBeDisabled();
  });

  it('shows availability and enables submit for a free valid name', async () => {
    const { checkAvailable } = setup({ checkAvailable: vi.fn().mockResolvedValue(true) });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'natalie' } });
    await waitFor(() => expect(checkAvailable).toHaveBeenCalledWith('natalie'));
    expect(await screen.findByText(/available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /claim/i })).toBeEnabled();
  });

  it('shows taken and disables submit when the name is taken', async () => {
    setup({ checkAvailable: vi.fn().mockResolvedValue(false) });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'natalie' } });
    expect(await screen.findByText(/taken/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /claim/i })).toBeDisabled();
  });

  it('calls onClaimed with the normalized name on successful submit', async () => {
    const { onClaimed } = setup({
      checkAvailable: vi.fn().mockResolvedValue(true),
      claim: vi.fn().mockResolvedValue({ ok: true }),
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Natalie' } });
    await screen.findByText(/available/i);
    fireEvent.click(screen.getByRole('button', { name: /claim/i }));
    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith('natalie'));
  });

  it('surfaces a race when the name is taken at submit time', async () => {
    setup({
      checkAvailable: vi.fn().mockResolvedValue(true),
      claim: vi.fn().mockResolvedValue({ ok: false, reason: 'taken' }),
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'natalie' } });
    await screen.findByText(/available/i);
    fireEvent.click(screen.getByRole('button', { name: /claim/i }));
    expect(await screen.findByText(/just taken/i)).toBeInTheDocument();
  });

  it('fails open (submit enabled) when the availability check rejects', async () => {
    setup({ checkAvailable: vi.fn().mockRejectedValue(new Error('network')) });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'natalie' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /claim/i })).toBeEnabled(),
    );
    expect(screen.queryByText(/available/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/taken/i)).not.toBeInTheDocument();
  });

  it('renders a skip button and calls onSkip when clicked', () => {
    const onSkip = vi.fn();
    setup({ onSkip });
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('does not render a skip button when onSkip is not provided', () => {
    setup();
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
  });

  it('disables the skip button and shows a busy label while skipping', () => {
    const onSkip = vi.fn();
    setup({ onSkip, skipping: true });
    const btn = screen.getByRole('button', { name: /setting up/i });
    expect(btn).toBeDisabled();
    expect(screen.queryByRole('button', { name: /skip for now/i })).not.toBeInTheDocument();
  });
});
