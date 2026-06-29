import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthSession } from './context/useAuthSession';
import { VerifyEmailNotice } from './VerifyEmailNotice';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { isPasswordValid } from './password-rules';
import { PasswordChecklist } from './PasswordChecklist';

function mapAuthError(message: string, mode: 'login' | 'signup' | 'reset'): string {
  if (mode === 'reset') return message;
  const m = message.toLowerCase();
  if (mode === 'login') {
    if (m.includes('invalid login credentials') || m.includes('invalid_credentials')) {
      return 'Wrong email or password.';
    }
    if (m.includes('email not confirmed')) {
      return 'Please verify your email before signing in.';
    }
    if (m.includes('user not found')) {
      return 'No account found with that email.';
    }
  } else {
    if (m.includes('user already registered') || m.includes('already_registered')) {
      return 'An account with that email already exists.';
    }
    if (m.includes('password should be at least')) {
      return 'Password must be at least 8 characters.';
    }
    if (m.includes('unable to validate email')) {
      return 'Please enter a valid email address.';
    }
  }
  return message;
}

type Mode = 'login' | 'signup' | 'reset';

export interface AuthCardProps {
  /** Called after a successful email/password sign-in. OAuth flows redirect on their own. */
  onAuthenticated?: () => void;
}

/**
 * The sign in / sign up card. Shared by the desktop /login page and the
 * mobile auth modal so both stay in sync.
 */
export function AuthCard({ onAuthenticated }: AuthCardProps) {
  const { session } = useAuthSession();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === 'signup') {
        if (!fullName.trim()) {
          setError('Full name is required');
          setLoading(false);
          return;
        }
        if (!agreedToTerms) {
          setError('Please agree to the Terms of Service to continue.');
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError('Passwords don’t match.');
          setLoading(false);
          return;
        }
        if (!isPasswordValid(password)) {
          setError('Password doesn’t meet the requirements.');
          setLoading(false);
          return;
        }
        await session.signUp(email, password, fullName);
        // Swap the card to the inline verify notice. We never reset verifyEmail in
        // handleSubmit: the form (and thus this handler) is unreachable while the
        // notice is shown — `onBack` is the only exit and it clears verifyEmail.
        setVerifyEmail(email);
      } else if (mode === 'reset') {
        await session.resetPassword(email);
        setSuccess('If an account exists for that email, a reset link is on its way.');
      } else {
        await session.signIn(email, password);
        onAuthenticated?.();
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(mapAuthError(raw, mode));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    try {
      await session.signInWithGoogle();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleApple = async () => {
    setError(null);
    try {
      await session.signInWithApple();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const reduce = useReducedMotion();
  const showConfirm = mode === 'signup' && password.length > 0;
  const passwordsMatch = password === confirmPassword;
  const passwordValid = isPasswordValid(password);

  return (
    <div
      className="w-full max-w-sm rounded-xl p-8"
      style={{
        background: 'var(--alabaster)',
        border: '1px solid var(--pale-stone)',
        boxShadow: '0 4px 24px rgba(58, 52, 38, 0.08)',
      }}
    >
      {/* Logo */}
      <div className="flex flex-col items-center mb-8">
        <img src="/logo-icon.png" alt="LivePsalms" className="notepad-nav-logo h-10 w-auto mb-3" />
        {!verifyEmail && (
          <h1
            className="text-lg font-medium"
            style={{
              color: 'var(--deep-umber)',
              fontFamily: 'Cormorant Garamond, serif',
            }}
          >
            {mode === 'login' ? 'Welcome Back' : mode === 'signup' ? 'Create Account' : 'Reset Password'}
          </h1>
        )}
      </div>

      {verifyEmail ? (
        <VerifyEmailNotice
          email={verifyEmail}
          onBack={() => {
            // Return to the sign-in form (not the populated sign-up form). Keep the
            // email they just signed up with prefilled; clear everything else.
            setVerifyEmail(null);
            setMode('login');
            setPassword('');
            setConfirmPassword('');
            setFullName('');
            setAgreedToTerms(false);
            setError(null);
            setSuccess(null);
          }}
          onVerified={() => onAuthenticated?.()}
        />
      ) : (
        <>
      {mode !== 'reset' && (
        <>
      {/* Google sign-in */}
      <button
        onClick={handleGoogle}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg mb-2 hover:bg-black/5 transition-colors"
        style={{
          border: '1px solid var(--pale-stone)',
          fontFamily: 'Outfit, sans-serif',
          fontSize: 13,
          color: 'var(--deep-umber)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>

      {/* Apple sign-in */}
      <button
        onClick={handleApple}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg mb-4 hover:opacity-90 transition-opacity"
        style={{
          background: '#000',
          color: '#fff',
          fontFamily: 'Outfit, sans-serif',
          fontSize: 13,
        }}
      >
        <svg width="16" height="18" viewBox="0 0 16 18" fill="#fff">
          <path d="M13.357 9.563c-.018-2.001 1.633-2.962 1.708-3.009-.93-1.359-2.376-1.545-2.892-1.566-1.232-.124-2.404.726-3.029.726-.625 0-1.59-.708-2.612-.689-1.343.02-2.583.781-3.275 1.984-1.396 2.42-.357 6.005 1.005 7.97.666.962 1.46 2.043 2.498 2.005 1.004-.041 1.383-.65 2.595-.65 1.21 0 1.553.65 2.612.628 1.078-.018 1.762-.985 2.422-1.95.762-1.118 1.078-2.205 1.097-2.262-.024-.011-2.108-.808-2.129-3.187zM11.394 3.69c.553-.671.926-1.602.824-2.527-.797.032-1.762.531-2.334 1.2-.513.594-.962 1.541-.84 2.45.888.069 1.797-.451 2.35-1.123z"/>
        </svg>
        Continue with Apple
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px" style={{ background: 'var(--pale-stone)' }} />
        <span
          className="text-[10px] tracking-widest"
          style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
        >
          OR
        </span>
        <div className="flex-1 h-px" style={{ background: 'var(--pale-stone)' }} />
      </div>
        </>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="auth-form flex flex-col gap-3">
        {mode === 'signup' && (
          <input
            type="text"
            placeholder="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{
              border: '1px solid var(--pale-stone)',
              background: 'var(--plaster)',
              fontFamily: 'Outfit, sans-serif',
              color: 'var(--deep-umber)',
            }}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
          style={{
            border: '1px solid var(--pale-stone)',
            background: 'var(--plaster)',
            fontFamily: 'Outfit, sans-serif',
            color: 'var(--deep-umber)',
          }}
        />
        {mode !== 'reset' && (
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (e.target.value === '') setConfirmPassword('');
            }}
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
        )}

        {mode === 'signup' && password.length > 0 && (
          <PasswordChecklist password={password} />
        )}

        <AnimatePresence initial={false}>
          {showConfirm && (
            <motion.div
              key="confirm-password"
              style={{ overflow: 'hidden' }}
              initial={{ height: 0, opacity: 0, y: -8 }}
              animate={{ height: 'auto', opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: -8 }}
              transition={{ duration: reduce ? 0 : 0.25, ease: 'easeOut' }}
            >
              <input
                type="password"
                placeholder="Verify Password"
                aria-label="Verify Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                style={{
                  border: '1px solid var(--pale-stone)',
                  background: 'var(--plaster)',
                  fontFamily: 'Outfit, sans-serif',
                  color: 'var(--deep-umber)',
                }}
              />
              {confirmPassword.length > 0 && (
                <p
                  aria-live="polite"
                  className="text-xs mt-1.5"
                  style={{
                    color: passwordsMatch ? '#27ae60' : '#c0392b',
                    fontFamily: 'Outfit, sans-serif',
                  }}
                >
                  {passwordsMatch ? '✓ Passwords match' : 'Passwords don’t match'}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {mode === 'login' && (
          <button
            type="button"
            onClick={() => {
              setMode('reset');
              setError(null);
              setSuccess(null);
              setConfirmPassword('');
            }}
            className="self-end text-xs underline hover:opacity-70 transition-opacity"
            style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
          >
            Forgot password?
          </button>
        )}

        {mode === 'signup' && (
          <label
            className="flex items-start gap-2 text-xs leading-snug cursor-pointer select-none"
            style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
          >
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              className="mt-0.5 shrink-0"
              style={{ accentColor: 'var(--deep-umber)' }}
            />
            <span>
              I agree to the{' '}
              <Link
                to="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:opacity-70 transition-opacity"
                style={{ color: 'var(--deep-umber)' }}
              >
                Terms of Service
              </Link>
              .
            </span>
          </label>
        )}

        {error && (
          <p className="text-xs" style={{ color: '#c0392b', fontFamily: 'Outfit, sans-serif' }}>
            {error}
          </p>
        )}
        {success && (
          <p className="text-xs" style={{ color: '#27ae60', fontFamily: 'Outfit, sans-serif' }}>
            {success}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || (mode === 'signup' && (!agreedToTerms || password !== confirmPassword || !passwordValid))}
          className="w-full py-2.5 rounded-lg text-sm font-medium transition-opacity"
          style={{
            background: 'var(--deep-umber)',
            color: 'var(--plaster)',
            fontFamily: 'Outfit, sans-serif',
            opacity: loading || (mode === 'signup' && (!agreedToTerms || password !== confirmPassword || !passwordValid)) ? 0.6 : 1,
          }}
        >
          {loading
            ? 'Please wait...'
            : mode === 'login'
              ? 'Sign In'
              : mode === 'signup'
                ? 'Create Account'
                : 'Send reset link'}
        </button>
      </form>

      {/* Toggle mode */}
      {mode === 'reset' ? (
        <p
          className="text-center text-xs mt-5"
          style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
        >
          <button
            onClick={() => {
              setMode('login');
              setError(null);
              setSuccess(null);
              setConfirmPassword('');
            }}
            className="underline hover:opacity-70 transition-opacity"
            style={{ color: 'var(--deep-umber)' }}
          >
            ← Back to sign in
          </button>
        </p>
      ) : (
        <p
          className="text-center text-xs mt-5"
          style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
        >
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError(null);
              setSuccess(null);
              setAgreedToTerms(false);
              setConfirmPassword('');
            }}
            className="underline hover:opacity-70 transition-opacity"
            style={{ color: 'var(--deep-umber)' }}
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      )}
        </>
      )}
    </div>
  );
}
