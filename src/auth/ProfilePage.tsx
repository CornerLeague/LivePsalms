import { useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, LogOut, Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthSession } from './context/useAuthSession';
import { useAccountProfile } from './context/useAccountProfile';
import { useAccountActions } from './context/useAccountActions';
import { getTierForCount } from '@/notepad/gamification/tiers';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { LamplightSettingsSection } from './components/LamplightSettingsSection';
import { BibleReadingSettingsSection } from './settings/BibleReadingSettingsSection';
import { ApplePersonalTokensSection } from './components/ApplePersonalTokensSection';
import { UsernameSection } from './components/UsernameSection';
import { AdminEntryLink } from './components/AdminEntryLink';
import { SecuritySection } from './components/SecuritySection';
import { SupabaseLamplightAdapter } from '@/notepad/storage/supabase-lamplight-adapter';
import { supabase as supabaseClient } from '@/lib/supabase';

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, loading, session } = useAuthSession();
  const { profile, account } = useAccountProfile();
  const accountActions = useAccountActions();
  const lamplightAdapter = useMemo(
    () => (supabaseClient ? new SupabaseLamplightAdapter(supabaseClient) : null),
    []
  );

  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(profile?.dateOfBirth ?? '');
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Redirect if not authenticated
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
        <p style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>Loading...</p>
      </div>
    );
  }

  const currentTier = getTierForCount(profile?.highestNoteCount ?? 0);
  const totalNotes = profile?.noteCount ?? 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      await account.updateProfile({
        fullName,
        dateOfBirth: dateOfBirth || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      await account.uploadAvatar(file);
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleExport = async () => {
    const data = await accountActions.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `psalms-notes-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteAccount = async () => {
    await accountActions.deleteAccount();
    navigate('/');
  };

  const handleSignOut = async () => {
    await session.signOut();
    navigate('/notepad');
  };

  const sectionStyle = {
    background: 'var(--alabaster)',
    border: '1px solid var(--pale-stone)',
    borderRadius: 12,
    padding: '24px',
  };

  const labelStyle = {
    fontSize: 10,
    fontWeight: 500 as const,
    letterSpacing: '0.15em',
    color: 'var(--silica)',
    fontFamily: 'Outfit, sans-serif',
    textTransform: 'uppercase' as const,
    marginBottom: 6,
  };

  const inputStyle = {
    border: '1px solid var(--pale-stone)',
    background: 'var(--plaster)',
    fontFamily: 'Outfit, sans-serif',
    color: 'var(--deep-umber)',
    fontSize: 13,
  };

  return (
    <div className="overflow-y-auto" style={{ height: '100dvh', background: 'var(--app-bg)' }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-6 py-4 border-b"
        style={{ borderColor: 'var(--pale-stone)' }}
      >
        <button
          onClick={() => navigate('/notepad/notes')}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-black/5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
        </button>
        <h1
          className="text-base font-medium"
          style={{
            color: 'var(--deep-umber)',
            fontFamily: 'Cormorant Garamond, serif',
          }}
        >
          Profile
        </h1>
      </div>

      <div className="max-w-lg mx-auto px-6 py-8 flex flex-col gap-6">
        {/* Avatar + Name Header */}
        <div className="flex items-center gap-5">
          <div className="relative">
            <div
              className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center cursor-pointer"
              onClick={handleAvatarClick}
              style={{
                background: 'var(--warm-sand)',
                border: '2px solid var(--pale-stone)',
              }}
            >
              {profile?.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span
                  className="text-2xl font-medium"
                  style={{
                    color: 'var(--plaster)',
                    fontFamily: 'Cormorant Garamond, serif',
                  }}
                >
                  {(profile?.fullName?.[0] ?? '?').toUpperCase()}
                </span>
              )}
              {avatarUploading && (
                <div className="absolute inset-0 rounded-full bg-black/30 flex items-center justify-center">
                  <span className="text-white text-xs" style={{ fontFamily: 'Outfit, sans-serif' }}>
                    ...
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={handleAvatarClick}
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
              style={{
                background: 'var(--deep-umber)',
                border: '2px solid var(--plaster)',
              }}
            >
              <Camera className="w-3 h-3" style={{ color: 'var(--plaster)' }} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="hidden"
            />
          </div>
          <div>
            <p
              className="text-lg font-medium"
              style={{
                color: 'var(--deep-umber)',
                fontFamily: 'Cormorant Garamond, serif',
              }}
            >
              {profile?.fullName}
            </p>
            <p
              className="text-xs"
              style={{
                color: 'rgba(var(--deep-umber-rgb), 0.8)',
                fontFamily: 'Outfit, sans-serif',
              }}
            >
              {user?.email}
            </p>
          </div>
        </div>

        <AdminEntryLink />

        {/* Tier Display */}
        <div style={sectionStyle}>
          <p style={labelStyle}>JOURNEY RANK</p>
          <p
            className="text-xl font-medium mb-1"
            style={{
              color: 'var(--deep-umber)',
              fontFamily: 'Cormorant Garamond, serif',
            }}
          >
            {currentTier.name}
          </p>
          <p
            className="text-xs italic mb-3"
            style={{
              color: 'var(--silica)',
              fontFamily: 'Cormorant Garamond, serif',
            }}
          >
            "{currentTier.scripture}" — {currentTier.reference}
          </p>
          <p className="text-xs" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
            {totalNotes} {totalNotes === 1 ? 'note' : 'notes'} written
          </p>
        </div>

        {/* Edit Profile */}
        <div style={sectionStyle}>
          <p style={labelStyle}>PROFILE</p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block mb-1" style={{ ...labelStyle, marginBottom: 4 }}>
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block mb-1" style={{ ...labelStyle, marginBottom: 4 }}>
                Date of Birth (optional)
              </label>
              <input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={inputStyle}
              />
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="self-end px-5 py-2 rounded-lg text-xs font-medium transition-opacity"
              style={{
                background: 'var(--deep-umber)',
                color: 'var(--plaster)',
                fontFamily: 'Outfit, sans-serif',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Username */}
        <UsernameSection
          currentUsername={profile?.username ?? null}
          checkAvailable={account.checkUsernameAvailable}
          setUsername={account.setUsername}
          sectionStyle={sectionStyle}
          labelStyle={labelStyle}
          inputStyle={inputStyle}
        />

        {/* Auth Management */}
        <SecuritySection
          providers={user?.app_metadata?.providers ?? []}
          sectionStyle={sectionStyle}
          labelStyle={labelStyle}
          onChangePassword={async () => {
            if (!user?.email) return;
            try {
              await session.resetPassword(user.email);
              toast.success('Password reset email sent.');
            } catch {
              toast.error('Could not send reset email. Please try again.');
            }
          }}
        />

        {/* Bible & Reading */}
        <BibleReadingSettingsSection sectionStyle={sectionStyle} labelStyle={labelStyle} />

        {/* Lamplight */}
        {user && lamplightAdapter && (
          <LamplightSettingsSection adapter={lamplightAdapter} userId={user.id} />
        )}

        {/* Connect Apple Notes */}
        {user && supabaseClient && (
          <ApplePersonalTokensSection client={supabaseClient} userId={user.id} />
        )}

        {/* Account Actions */}
        <div style={sectionStyle}>
          <p style={labelStyle}>ACCOUNT</p>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleExport}
              className="flex items-center gap-2 text-xs hover:opacity-70 transition-opacity"
              style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
            >
              <Download className="w-3.5 h-3.5" />
              Export All Notes
            </button>

            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 text-xs hover:opacity-70 transition-opacity"
              style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  className="flex items-center gap-2 text-xs hover:opacity-70 transition-opacity mt-2"
                  style={{ color: '#c0392b', fontFamily: 'Outfit, sans-serif' }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Account
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle
                    style={{ fontFamily: 'Cormorant Garamond, serif' }}
                  >
                    Delete Account?
                  </AlertDialogTitle>
                  <AlertDialogDescription
                    style={{ fontFamily: 'Outfit, sans-serif', fontSize: 13 }}
                  >
                    Are you sure you want to go ahead with this feature? This will
                    permanently delete your account, all your notes, folders, and
                    profile data. This action cannot be undone. If you'd like to
                    keep a copy of your notes, use 'Export All Notes' above
                    before deleting.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    style={{ fontFamily: 'Outfit, sans-serif', fontSize: 13 }}
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAccount}
                    style={{
                      background: '#c0392b',
                      fontFamily: 'Outfit, sans-serif',
                      fontSize: 13,
                    }}
                  >
                    Delete Account
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </div>
  );
}
