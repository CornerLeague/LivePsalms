// src/auth/components/ApplePersonalTokensSection.tsx
import { useEffect, useState, useCallback } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createToken, listTokens, revokeToken, countImportedNotes, type PersonalToken,
} from '../personal-tokens';
import { detectApplePlatform, deriveImportStatus, type ImportTone } from '../apple-import-status';

// Baked into the distributed Apple Shortcut by maintainers; intentionally NOT
// rendered in the panel anymore (users never need the raw endpoint). Exported
// so it stays available to maintainers/tooling without tripping noUnusedLocals.
export const IMPORT_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/import-apple-note`;
const APPLE_SHORTCUT_ICLOUD_URL = 'https://www.icloud.com/shortcuts/bcf5f879ac954f3cbf7d99c3d5ffe29a';
const SHORTCUTS_APP_STORE_URL = 'https://apps.apple.com/app/shortcuts/id915249334';

const TONE_BG: Record<ImportTone, string> = {
  success: 'rgba(120, 160, 110, 0.16)',
  waiting: 'var(--pale-stone)',
  idle: 'var(--pale-stone)',
};

export interface ApplePersonalTokensSectionProps {
  client: SupabaseClient;
  userId: string;
}

export function ApplePersonalTokensSection({ client, userId }: ApplePersonalTokensSectionProps) {
  const [list, setList] = useState<PersonalToken[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [raw, setRaw] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [platform] = useState(() => detectApplePlatform(navigator.userAgent));

  const refresh = useCallback(async () => {
    try {
      const [t, count] = await Promise.all([
        listTokens(client),
        // A count failure must not block the panel — treat as 0 (spec error handling).
        countImportedNotes(client).catch(() => 0),
      ]);
      setList(t);
      setImportedCount(count);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tokens');
    }
  }, [client]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Clear the "Copied" confirmation a moment after it appears.
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const onCopy = () => {
    if (!raw) return;
    void navigator.clipboard?.writeText(raw);
    setCopied(true);
  };

  const onGenerate = async () => {
    setBusy(true); setError(null); setCopied(false);
    try {
      const token = await createToken(client, userId, 'Apple Notes Shortcut');
      setRaw(token);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create token');
    } finally { setBusy(false); }
  };

  const onRevoke = async (id: string) => {
    setBusy(true); setError(null);
    try { await revokeToken(client, id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to revoke token'); }
    finally { setBusy(false); }
  };

  // Most-recent last-used across active tokens (ISO strings sort lexicographically).
  const lastUsedAt = list.reduce<string | null>((acc, t) => {
    if (!t.lastUsedAt) return acc;
    return !acc || t.lastUsedAt > acc ? t.lastUsedAt : acc;
  }, null);

  const status = deriveImportStatus({ tokenCount: list.length, lastUsedAt, importedCount });

  const isApple = platform === 'ios' || platform === 'macos';
  const devicePhrase = platform === 'ios' ? 'on your iPhone or iPad' : 'on your Mac';

  return (
    <section
      aria-labelledby="apple-notes-heading"
      className="px-6 py-6 rounded-xl"
      style={{ background: 'var(--alabaster)', border: '1px solid var(--pale-stone)' }}
    >
      <h3
        id="apple-notes-heading"
        className="text-sm mb-2"
        style={{ fontFamily: 'Cormorant Garamond, serif', color: 'var(--deep-umber)' }}
      >
        Connect Apple Notes
      </h3>

      <div
        role="status"
        className="mb-4 px-3 py-2 rounded-lg"
        style={{ background: TONE_BG[status.tone], fontFamily: 'Outfit, sans-serif' }}
      >
        <p
          className="text-xs"
          style={{ color: status.tone === 'idle' ? 'var(--silica)' : 'var(--deep-umber)' }}
        >
          {status.headline}
        </p>
        {status.detail && (
          <p className="text-xs mt-1" style={{ color: 'var(--silica)' }}>{status.detail}</p>
        )}
      </div>

      {isApple ? (
        <>
          <p
            className="text-xs mb-3"
            style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
          >
            Generate a token, then install the Shortcut and run it {devicePhrase} to bring
            your Apple Notes into Psalms.
          </p>
          <div className="flex flex-col gap-2 mb-4">
            <a
              href={APPLE_SHORTCUT_ICLOUD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-2 rounded-lg flex items-center justify-center"
              style={{
                background: 'var(--deep-umber)',
                color: 'var(--alabaster)',
                fontFamily: 'Outfit, sans-serif',
              }}
            >
              Install Shortcut
            </a>
            <a
              href={SHORTCUTS_APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline text-center"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
            >
              Get the Shortcuts app
            </a>
          </div>
        </>
      ) : (
        <p
          className="text-xs mb-4"
          style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
        >
          Apple Notes import needs an iPhone, iPad, or Mac. You can still generate a token
          here to use on your Apple device.
        </p>
      )}

      <button
        type="button"
        onClick={() => void onGenerate()}
        disabled={busy}
        className="text-xs px-3 py-2 rounded-lg mb-2 disabled:opacity-50"
        style={{
          background: 'var(--deep-umber)',
          color: 'var(--alabaster)',
          fontFamily: 'Outfit, sans-serif',
        }}
      >
        Generate token
      </button>

      {raw && (
        <div
          role="status"
          className="mb-4 px-3 py-3 rounded-lg"
          style={{ background: 'var(--pale-stone)' }}
        >
          <p
            className="text-xs mb-2"
            style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
          >
            <strong>Copy this token now &mdash; you won&rsquo;t see it again.</strong>
          </p>
          <code
            className="block text-xs break-all mb-2"
            style={{ color: 'var(--deep-umber)', fontFamily: 'monospace' }}
          >
            {raw}
          </code>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              className="text-xs underline"
              style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
            >
              Copy
            </button>
            {copied && (
              <span
                role="status"
                className="text-xs"
                style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
              >
                Copied
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="text-xs mb-3"
          style={{ color: '#b04040', fontFamily: 'Outfit, sans-serif' }}
        >
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {list.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-3 text-xs"
            style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
          >
            <span>{t.name}</span>
            <span style={{ color: 'var(--silica)' }}>
              {t.lastUsedAt
                ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                : 'never used'}
            </span>
            <button
              type="button"
              onClick={() => void onRevoke(t.id)}
              disabled={busy}
              className="underline disabled:opacity-50"
              style={{ color: '#b04040' }}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
