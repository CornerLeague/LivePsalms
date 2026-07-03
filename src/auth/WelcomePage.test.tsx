// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const updateProfile = vi.fn(async () => {});
const importNote = vi.fn(async (n) => n);
vi.mock('./context/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'u1' }, loading: false, adapter: { importNote } }),
}));
vi.mock('./context/useAccountProfile', () => ({
  useAccountProfile: () => ({ profile: { fullName: '' }, account: { updateProfile } }),
}));

import { WelcomePage } from './WelcomePage';

afterEach(() => {
  cleanup();
  navigate.mockClear();
  updateProfile.mockClear();
  importNote.mockClear();
});

describe('WelcomePage onboarding flow', () => {
  it('advances to the import step after saving the profile (no navigation yet)', async () => {
    render(<WelcomePage />);
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Sarah' } });
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /skip for now/i })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('Skip on the import step navigates to the notepad', async () => {
    render(<WelcomePage />);
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Sarah' } });
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    const skip = await screen.findByRole('button', { name: /skip for now/i });
    fireEvent.click(skip);
    expect(navigate).toHaveBeenCalledWith('/notebook/notes');
  });
});
