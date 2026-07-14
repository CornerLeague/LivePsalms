// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ApplePersonalTokensSection } from './ApplePersonalTokensSection';
import * as tokens from '../personal-tokens';

vi.mock('../personal-tokens', async (orig) => {
  const actual = await orig<typeof import('../personal-tokens')>();
  return {
    ...actual,
    createToken: vi.fn(),
    listTokens: vi.fn(),
    revokeToken: vi.fn(),
    countImportedNotes: vi.fn(),
  };
});

const client = {} as never;

const REAL_UA = window.navigator.userAgent;
function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

beforeEach(() => {
  vi.mocked(tokens.listTokens).mockResolvedValue([]);
  vi.mocked(tokens.createToken).mockResolvedValue('psalms_pat_RAWVALUE123');
  vi.mocked(tokens.revokeToken).mockResolvedValue();
  vi.mocked(tokens.countImportedNotes).mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
  setUserAgent(REAL_UA);
});

describe('ApplePersonalTokensSection', () => {
  it('reveals the raw token once after generating', async () => {
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: /generate token/i }));
    await waitFor(() => expect(screen.getByText('psalms_pat_RAWVALUE123')).toBeInTheDocument());
    expect(tokens.createToken).toHaveBeenCalledWith(client, 'u-1', expect.any(String));
  });

  it('lists existing tokens and revokes one', async () => {
    vi.mocked(tokens.listTokens).mockResolvedValue([
      { id: 't1', name: 'Apple Notes Shortcut', lastUsedAt: null, createdAt: '2026-06-11T00:00:00Z' },
    ]);
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    await waitFor(() => expect(screen.getByText('Apple Notes Shortcut')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }));
    expect(tokens.revokeToken).toHaveBeenCalledWith(client, 't1');
  });

  it('shows a success banner with imported count when notes have been imported', async () => {
    vi.mocked(tokens.listTokens).mockResolvedValue([
      { id: 't1', name: 'Apple Notes Shortcut', lastUsedAt: '2026-06-12T11:58:00Z', createdAt: '2026-06-11T00:00:00Z' },
    ]);
    vi.mocked(tokens.countImportedNotes).mockResolvedValue(3);
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    await waitFor(() => expect(screen.getByText(/3 notes imported/i)).toBeInTheDocument());
  });

  it('shows the non-Apple note but still offers token generation', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    expect(screen.getByText(/needs an iPhone, iPad, or Mac/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate token/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /install shortcut/i })).toBeNull();
  });

  it('shows the Install Shortcut link pointing at the iCloud shortcut on Apple devices', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15');
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    const install = screen.getByRole('link', { name: /install shortcut/i });
    expect(install).toHaveAttribute('href', 'https://www.icloud.com/shortcuts/bcf5f879ac954f3cbf7d99c3d5ffe29a');
    expect(screen.getByRole('link', { name: /get the shortcuts app/i }))
      .toHaveAttribute('href', 'https://apps.apple.com/app/shortcuts/id915249334');
  });

  it('never renders the raw import endpoint URL', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15');
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    expect(screen.queryByText(/functions\/v1\/import-apple-note/)).toBeNull();
  });

  it('shows a "Copied" confirmation after clicking Copy', async () => {
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: /generate token/i }));
    await waitFor(() => expect(screen.getByText('psalms_pat_RAWVALUE123')).toBeInTheDocument());
    expect(screen.queryByText(/^copied$/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    expect(screen.getByText(/^copied$/i)).toBeInTheDocument();
  });

  it('renders the four numbered guide steps', async () => {
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    await waitFor(() => expect(screen.getByText('Generate your token')).toBeInTheDocument());
    expect(screen.getByText('Install the Shortcut')).toBeInTheDocument();
    expect(screen.getByText('Run it & choose your notes')).toBeInTheDocument();
    expect(screen.getByText('Confirm your import')).toBeInTheDocument();
  });

  it('marks the token step done and install active once a token exists', async () => {
    vi.mocked(tokens.listTokens).mockResolvedValue([
      { id: 't1', name: 'Apple Notes Shortcut', lastUsedAt: null, createdAt: '2026-06-11T00:00:00Z' },
    ]);
    const { container } = render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    await waitFor(() =>
      expect(container.querySelector('[data-step-id="token"]')).toHaveAttribute('data-step-state', 'done'),
    );
    expect(container.querySelector('[data-step-id="install"]')).toHaveAttribute('data-step-state', 'active');
    expect(container.querySelector('[data-step-id="run"]')).toHaveAttribute('data-step-state', 'upcoming');
  });

  it('marks the confirm step done when notes have been imported', async () => {
    vi.mocked(tokens.listTokens).mockResolvedValue([
      { id: 't1', name: 'Apple Notes Shortcut', lastUsedAt: '2026-06-12T11:58:00Z', createdAt: '2026-06-11T00:00:00Z' },
    ]);
    vi.mocked(tokens.countImportedNotes).mockResolvedValue(3);
    const { container } = render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    await waitFor(() =>
      expect(container.querySelector('[data-step-id="confirm"]')).toHaveAttribute('data-step-state', 'done'),
    );
  });

  it('shows the expandable detailed walkthrough', async () => {
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    expect(screen.getByText(/see the full step-by-step/i)).toBeInTheDocument();
    // Walkthrough-only phrasing (not present in the compact step body):
    expect(screen.getByText(/where they land/i)).toBeInTheDocument();
  });

  it('always shows the edit-makes-a-duplicate and safe-to-re-run note', () => {
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    expect(screen.getByText(/re-importing creates a/i)).toBeInTheDocument();
    expect(screen.getByText(/run the Shortcut again anytime/i)).toBeInTheDocument();
  });
});
