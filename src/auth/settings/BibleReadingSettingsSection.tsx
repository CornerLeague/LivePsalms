import { useEffect, useState, type CSSProperties } from 'react';
import { toast } from 'sonner';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
import { TRANSLATIONS, translationInfo, type BibleTranslation } from '@/notepad/bible/translations';
import { readerFallbackNotice } from '@/notepad/bible/fallback-notice';
import { VERSE_LAYOUTS, VERSE_LAYOUT_LABEL, type VerseLayout } from '@/notepad/bible/bible-layout-types';

export function BibleReadingSettingsSection({
  sectionStyle,
  labelStyle,
}: { sectionStyle?: CSSProperties; labelStyle?: CSSProperties } = {}) {
  // textSize has no dedicated control on this page yet (it's set from the reader/
  // editor toolbar controls) — Save still round-trips the device's current value
  // so it isn't clobbered on the profile row.
  const { translation, verseLayout, textSize, saveGlobalPrefs } = useBiblePrefs();

  // Draft state — edits stay local to the form until Save. Re-seed whenever the
  // saved (global) value changes: the first-load DB seed, or a successful Save.
  const [draftTranslation, setDraftTranslation] = useState<BibleTranslation>(translation);
  const [draftLayout, setDraftLayout] = useState<VerseLayout>(verseLayout);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => { setDraftTranslation(translation); }, [translation]);
  useEffect(() => { setDraftLayout(verseLayout); }, [verseLayout]);

  // saveGlobalPrefs updates the context optimistically — the local setState lands
  // before the DB write resolves and is never rolled back on failure. So after a
  // failed save draft === context and `dirty` alone is false. Track the failure so
  // Save stays enabled for a retry; a successful save clears it.
  const dirty = draftTranslation !== translation || draftLayout !== verseLayout;

  async function handleSave() {
    setSaving(true);
    const result = await saveGlobalPrefs({ translation: draftTranslation, verseLayout: draftLayout, textSize });
    setSaving(false);
    if (result.ok) {
      setSaveFailed(false);
      toast.success('Bible settings saved');
    } else {
      setSaveFailed(true);
      toast.error(result.error ?? 'Could not save Bible settings');
    }
  }

  return (
    <div style={sectionStyle}>
      <p style={labelStyle}>BIBLE &amp; READING</p>

      <label
        htmlFor="settings-bible-version"
        className="block text-xs mb-1"
        style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
      >
        Bible version
      </label>
      <select
        id="settings-bible-version"
        aria-label="Bible version"
        value={draftTranslation}
        onChange={(e) => setDraftTranslation(e.target.value as BibleTranslation)}
        className="text-xs rounded px-2 py-1 outline-none"
        style={{ color: 'var(--deep-umber)', background: 'transparent', border: '1px solid var(--pale-stone)' }}
      >
        {TRANSLATIONS.map((t) => (
          <option key={t.id} value={t.id}>{t.fullName} ({t.label})</option>
        ))}
      </select>
      <p className="text-[10px] mt-1" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
        {translationInfo(draftTranslation).attribution}
      </p>
      {readerFallbackNotice(draftTranslation) && (
        <p role="note" className="text-[10px] mt-1" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
          {readerFallbackNotice(draftTranslation)}
        </p>
      )}

      <p className="block text-xs mt-4 mb-1" style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}>
        Verse layout
      </p>
      <div className="flex gap-2">
        {VERSE_LAYOUTS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={draftLayout === l}
            onClick={() => setDraftLayout(l)}
            className="text-[11px] rounded-full px-3 py-1"
            style={{
              fontFamily: 'Outfit, sans-serif',
              border: '1px solid var(--pale-stone)',
              background: draftLayout === l ? 'var(--deep-umber)' : 'transparent',
              color: draftLayout === l ? '#fff' : 'var(--deep-umber)',
            }}
          >
            {VERSE_LAYOUT_LABEL[l]}
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-label="Save Bible settings"
        disabled={saving || (!dirty && !saveFailed)}
        onClick={handleSave}
        className="mt-4 text-xs rounded px-3 py-1 disabled:opacity-40"
        style={{
          fontFamily: 'Outfit, sans-serif',
          border: '1px solid var(--pale-stone)',
          background: 'var(--deep-umber)',
          color: '#fff',
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
