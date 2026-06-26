import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useVerseLexicon, type InterlinearWord, type LexiconLanguage } from './useVerseLexicon';
import { useStrongsEntry } from './useStrongsEntry';

const LANGUAGE_LABEL: Record<LexiconLanguage, string> = {
  hebrew: 'Hebrew',
  aramaic: 'Aramaic',
  greek: 'Greek',
};

const ATTRIBUTION = 'Original-language data: STEPBible (TAHOT/TAGNT, CC BY 4.0) + OpenScriptures Strong\'s.';
const muted: React.CSSProperties = { fontSize: 12, color: 'var(--silica)', margin: 0 };

export interface OriginalLanguagePanelProps {
  verseId: string | null;
  reference: string | null;
}

export function OriginalLanguagePanel({ verseId, reference }: OriginalLanguagePanelProps) {
  const [open, setOpen] = useState(true);
  const { words, language, loading, error } = useVerseLexicon(verseId);

  return (
    <section style={{ marginBottom: 24, borderBottom: '1px solid var(--pale-stone)', paddingBottom: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} />}
        <span style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--silica)' }}>ORIGINAL LANGUAGE</span>
        {language && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--lamplight-accent)', fontWeight: 600 }}>{LANGUAGE_LABEL[language]}</span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {verseId == null && (
            <p style={{ ...muted, fontStyle: 'italic' }}>Tap a verse in the reader to see its Hebrew &amp; Greek.</p>
          )}
          {verseId != null && loading && <p style={muted}>Loading…</p>}
          {verseId != null && !loading && error && <p style={muted}>Couldn&apos;t load original-language data.</p>}
          {verseId != null && !loading && !error && words.length === 0 && (
            <p style={muted}>Original-language data isn&apos;t available for this verse.</p>
          )}
          {verseId != null && !loading && !error && words.length > 0 && (
            <>
              {reference && <div style={{ fontSize: 11, color: 'var(--deep-umber)', fontWeight: 600, marginBottom: 8 }}>{reference}</div>}
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {words.map((w) => (
                  <WordRow key={w.position} word={w} rtl={language !== 'greek'} />
                ))}
              </ul>
              <p style={{ fontSize: 10, color: 'var(--silica)', margin: '12px 0 0' }}>{ATTRIBUTION}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function WordRow({ word, rtl }: { word: InterlinearWord; rtl: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li style={{ borderRadius: 8, background: 'var(--cream, #F4F1EA)', padding: '6px 8px' }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{ display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
      >
        <span dir={rtl ? 'rtl' : 'ltr'} style={{ fontSize: 18, color: 'var(--deep-umber)' }}>{word.original}</span>
        <span style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--silica)' }}>{word.transliteration}</span>
        <span style={{ fontSize: 11, color: 'var(--deep-umber)' }}>{word.gloss}</span>
        {word.strongs && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--lamplight-accent)', fontWeight: 600 }}>{word.strongs}</span>}
      </button>
      {expanded && (
        <div style={{ marginTop: 6 }}>
          {word.morph && <div style={{ fontSize: 11, color: 'var(--silica)' }}>{word.morph}</div>}
          {word.strongs && <StrongsDefinition strongs={word.strongs} />}
        </div>
      )}
    </li>
  );
}

function StrongsDefinition({ strongs }: { strongs: string }) {
  const { entry, loading, error } = useStrongsEntry(strongs);
  if (loading) return <p style={{ fontSize: 11, color: 'var(--silica)', margin: '4px 0 0' }}>Loading definition…</p>;
  if (error || !entry) return <p style={{ fontSize: 11, color: 'var(--silica)', margin: '4px 0 0' }}>Definition unavailable.</p>;
  return (
    <div style={{ fontSize: 11, color: 'var(--deep-umber)', marginTop: 4, lineHeight: 1.5 }}>
      <strong>{entry.lemma}</strong>{entry.pronunciation ? ` · ${entry.pronunciation}` : ''}
      <div style={{ marginTop: 2 }}>{entry.fullDef || entry.shortDef}</div>
    </div>
  );
}
