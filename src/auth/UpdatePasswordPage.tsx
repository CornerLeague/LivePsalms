import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthSession } from './context/useAuthSession';
import { isPasswordValid } from './password-rules';
import { PasswordChecklist } from './PasswordChecklist';

/**
 * Landing page for the password-reset email link. Supabase exchanges the
 * recovery token on arrival and establishes a temporary session, so the
 * submit goes through `AuthSession.updatePassword` like any other credential
 * operation. Minimal scaffold — refine the UX as needed.
 */
export function UpdatePasswordPage() {
  const navigate = useNavigate();
  const { session } = useAuthSession();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const passwordValid = isPasswordValid(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!isPasswordValid(password)) {
      setError('Password doesn’t meet the requirements.');
      return;
    }
    setLoading(true);
    try {
      await session.updatePassword(password);
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--app-bg)' }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-8"
        style={{
          background: 'var(--alabaster)',
          border: '1px solid var(--pale-stone)',
          boxShadow: '0 4px 24px rgba(58, 52, 38, 0.08)',
        }}
      >
        <div className="flex flex-col items-center mb-8">
          <img src="/logo-icon.png" alt="LivePsalms" className="h-10 w-auto mb-3" />
          <h1
            className="text-lg font-medium"
            style={{ color: 'var(--deep-umber)', fontFamily: 'Cormorant Garamond, serif' }}
          >
            Set a New Password
          </h1>
        </div>

        {done ? (
          <div className="flex flex-col gap-4">
            <p
              className="text-sm text-center"
              style={{ color: '#27ae60', fontFamily: 'Outfit, sans-serif' }}
            >
              Your password has been updated.
            </p>
            <button
              onClick={() => navigate('/notebook/notes')}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-opacity"
              style={{
                background: 'var(--deep-umber)',
                color: 'var(--plaster)',
                fontFamily: 'Outfit, sans-serif',
              }}
            >
              Continue
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="password"
              placeholder="New Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{
                border: '1px solid var(--pale-stone)',
                background: 'var(--plaster)',
                fontFamily: 'Outfit, sans-serif',
                color: 'var(--deep-umber)',
              }}
            />
            {password.length > 0 && <PasswordChecklist password={password} />}
            <input
              type="password"
              placeholder="Confirm New Password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{
                border: '1px solid var(--pale-stone)',
                background: 'var(--plaster)',
                fontFamily: 'Outfit, sans-serif',
                color: 'var(--deep-umber)',
              }}
            />

            {error && (
              <p className="text-xs" style={{ color: '#c0392b', fontFamily: 'Outfit, sans-serif' }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !passwordValid}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-opacity"
              style={{
                background: 'var(--deep-umber)',
                color: 'var(--plaster)',
                fontFamily: 'Outfit, sans-serif',
                opacity: loading || !passwordValid ? 0.6 : 1,
              }}
            >
              {loading ? 'Please wait...' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
