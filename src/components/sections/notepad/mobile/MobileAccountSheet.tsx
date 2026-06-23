// src/components/sections/notepad/mobile/MobileAccountSheet.tsx
import { User, LogOut } from 'lucide-react';

export interface MobileAccountSheetProps {
  open: boolean;
  onClose: () => void;
  onProfile: () => void;
  onSignOut: () => void;
}

export function MobileAccountSheet({ open, onClose, onProfile, onSignOut }: MobileAccountSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ fontFamily: 'Outfit, sans-serif' }}>
      <button
        aria-label="Close account menu"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.35)' }}
      />
      <div
        className="relative rounded-t-2xl flex flex-col"
        style={{
          background: 'var(--notepad-page-bg)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: '0 -8px 28px rgba(0,0,0,0.18)',
        }}
      >
        <div className="flex justify-center pt-2">
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--pale-stone)' }} />
        </div>

        <div className="flex flex-col py-2">
          <button
            onClick={onProfile}
            className="flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left"
            style={{ color: 'var(--deep-umber)' }}
          >
            <User size={18} />
            Profile &amp; Settings
          </button>
          <button
            onClick={onSignOut}
            className="flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left"
            style={{ color: 'var(--deep-umber)' }}
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
