import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuthSession } from './context/useAuthSession';
import { useAccountProfile } from './context/useAccountProfile';
import { WelcomeImportStep } from './WelcomeImportStep';

export function WelcomePage() {
  const navigate = useNavigate();
  const { user, loading, adapter } = useAuthSession();
  const { profile, account } = useAccountProfile();

  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<'profile' | 'import'>('profile');
  const goNotepad = () => navigate('/notebook/notes');

  if (!loading && !user) {
    navigate('/login');
    return null;
  }

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--app-bg)' }}
      >
        <p style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
          Loading...
        </p>
      </div>
    );
  }

  const handleContinue = async () => {
    if (!fullName.trim()) {
      toast.error('Please enter your name to continue.');
      return;
    }
    setSaving(true);
    try {
      await account.updateProfile({
        fullName: fullName.trim(),
        dateOfBirth: dateOfBirth || null,
      });
      setStep('import');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    border: '1px solid var(--pale-stone)',
    background: 'var(--plaster)',
    fontFamily: 'Outfit, sans-serif',
    color: 'var(--deep-umber)',
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
        {/* Avatar / Logo */}
        <div className="flex flex-col items-center mb-6">
          {profile?.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt="Avatar"
              className="w-16 h-16 rounded-full object-cover mb-4"
              style={{ border: '2px solid var(--pale-stone)' }}
            />
          ) : (
            <img
              src="/logo-icon.png"
              alt="LivePsalms"
              className="h-12 w-auto mb-4"
            />
          )}
          <h1
            className="text-xl font-medium mb-1"
            style={{
              color: 'var(--deep-umber)',
              fontFamily: 'Cormorant Garamond, serif',
            }}
          >
            Welcome to Psalms
          </h1>
          <p
            className="text-xs text-center"
            style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
          >
            {step === 'profile'
              ? 'Just a couple of details to get you started.'
              : 'Bring any notes you already have — or skip for now.'}
          </p>
        </div>

        {step === 'profile' ? (
        <div className="flex flex-col gap-4">
          <div>
            <label
              className="block mb-1.5 text-[10px] tracking-[0.15em] font-medium uppercase"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
            >
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={inputStyle}
            />
          </div>

          <div>
            <label
              className="block mb-1.5 text-[10px] tracking-[0.15em] font-medium uppercase"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
            >
              Date of Birth (optional)
            </label>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={inputStyle}
            />
            <p
              className="text-[10px] mt-1"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
            >
              You can always add this later in your profile.
            </p>
          </div>

          <button
            onClick={handleContinue}
            disabled={saving}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-opacity mt-2"
            style={{
              background: 'var(--deep-umber)',
              color: 'var(--plaster)',
              fontFamily: 'Outfit, sans-serif',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Continue'}
          </button>

        </div>
        ) : (
          <WelcomeImportStep adapter={adapter} onDone={goNotepad} onSkip={goNotepad} />
        )}
      </div>
    </div>
  );
}
