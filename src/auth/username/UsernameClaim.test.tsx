// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { UsernameClaim } from './UsernameClaim';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const setUsername = vi.fn();
const checkUsernameAvailable = vi.fn().mockResolvedValue(true);
vi.mock('@/auth/context/useAccountProfile', () => ({
  useAccountProfile: () => ({
    account: { setUsername, checkUsernameAvailable },
  }),
}));

beforeEach(() => {
  navigate.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
  setUsername.mockReset();
});
afterEach(cleanup);

describe('UsernameClaim skip', () => {
  it('generates a username, navigates, and toasts on skip', async () => {
    setUsername.mockResolvedValue({ ok: true });
    render(<UsernameClaim />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));

    await waitFor(() => expect(setUsername).toHaveBeenCalledTimes(1));
    const claimed = setUsername.mock.calls[0][0] as string;
    expect(claimed).toMatch(/^[a-z]+_[a-z]+_\d{4}$/);
    expect(navigate).toHaveBeenCalledWith(`/notebook/u/${claimed}`, { replace: true });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0][0]).toContain(claimed);
  });

  it('retries with a new name when the first candidate is taken', async () => {
    setUsername
      .mockResolvedValueOnce({ ok: false, reason: 'taken' })
      .mockResolvedValueOnce({ ok: true });
    render(<UsernameClaim />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));

    await waitFor(() => expect(setUsername).toHaveBeenCalledTimes(2));
    const finalName = setUsername.mock.calls[1][0] as string;
    expect(navigate).toHaveBeenCalledWith(`/notebook/u/${finalName}`, { replace: true });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it('toasts an error when all attempts are taken', async () => {
    setUsername.mockResolvedValue({ ok: false, reason: 'taken' });
    render(<UsernameClaim />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await waitFor(() => expect(setUsername).toHaveBeenCalledTimes(5));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('toasts an error and stops immediately on a non-taken failure', async () => {
    setUsername.mockResolvedValue({ ok: false, reason: 'invalid' });
    render(<UsernameClaim />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await waitFor(() => expect(setUsername).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not launch a second skip while one is in flight', async () => {
    let resolveFirst: (v: { ok: true }) => void = () => {};
    setUsername.mockImplementationOnce(
      () => new Promise((res) => { resolveFirst = res; }),
    );
    render(<UsernameClaim />);
    const btn = screen.getByRole('button', { name: /skip/i });
    fireEvent.click(btn);
    fireEvent.click(btn); // second click while first is pending
    resolveFirst({ ok: true });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(setUsername).toHaveBeenCalledTimes(1);
  });
});
