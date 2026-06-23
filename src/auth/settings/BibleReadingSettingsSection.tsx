import type { CSSProperties } from 'react';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
import { TRANSLATIONS, translationInfo, type BibleTranslation } from '@/notepad/bible/translations';
import { VERSE_LAYOUTS, VERSE_LAYOUT_LABEL } from '@/notepad/bible/bible-layout-types';

export function BibleReadingSettingsSection({
  sectionStyle,
  labelStyle,
}: { sectionStyle?: CSSProperties; labelStyle?: CSSProperties } = {}) {
  const { translation, setTranslation, verseLayout, setVerseLayout } = useBiblePrefs();

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
        value={translation}
        onChange={(e) => setTranslation(e.target.value as BibleTranslation)}
        className="text-xs rounded px-2 py-1 outline-none"
        style={{ color: 'var(--deep-umber)', background: 'transparent', border: '1px solid var(--pale-stone)' }}
      >
        {TRANSLATIONS.map((t) => (
          <option key={t.id} value={t.id}>{t.fullName} ({t.label})</option>
        ))}
      </select>
      <p className="text-[10px] mt-1" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
        {translationInfo(translation).attribution}
      </p>

      <p className="block text-xs mt-4 mb-1" style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}>
        Verse layout
      </p>
      <div className="flex gap-2">
        {VERSE_LAYOUTS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={verseLayout === l}
            onClick={() => setVerseLayout(l)}
            className="text-[11px] rounded-full px-3 py-1"
            style={{
              fontFamily: 'Outfit, sans-serif',
              border: '1px solid var(--pale-stone)',
              background: verseLayout === l ? 'var(--deep-umber)' : 'transparent',
              color: verseLayout === l ? '#fff' : 'var(--deep-umber)',
            }}
          >
            {VERSE_LAYOUT_LABEL[l]}
          </button>
        ))}
      </div>
    </div>
  );
}
