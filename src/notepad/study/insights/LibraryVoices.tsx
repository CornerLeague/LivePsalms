// src/notepad/study/insights/LibraryVoices.tsx
// "Voices from the Church's Study" — the class-B section of the Insights
// Reference door. Every word on screen is quoted corpus text with a named
// source; nothing here is generated, so nothing here can be hallucinated.
//
// The coverage line is read from the traditions actually present in the data
// (design §3.3). It must never hardcode a tradition list: as Phase-A2 sources
// are licensed and ingested, this section widens on its own, and until then it
// must not imply coverage the corpus does not have.
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LibraryVoice } from './useLibraryVoices';

export interface LibraryVoicesProps {
  voices: LibraryVoice[];
  loading: boolean;
}

const headingStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: '0.12em',
  color: 'var(--silica)',
  margin: '0 0 8px',
};

export function LibraryVoices({ voices, loading }: LibraryVoicesProps) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());

  // Absent, not empty. A chapter nobody commented on gets no heading, no
  // placeholder, and no apology — same for the loading window, which would
  // otherwise flash a heading over nothing.
  if (loading || voices.length === 0) return null;

  const traditions = [...new Set(voices.map((v) => v.tradition).filter(Boolean))];

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={headingStyle}>VOICES FROM THE CHURCH&apos;S STUDY</h3>
      <p style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--silica)', margin: '0 0 12px' }}>
        In the library so far: {traditions.join(' · ')}. More traditions join this section as their
        sources are licensed.
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {voices.map((v) => {
          const open = openIds.has(v.chunkId);
          return (
            <li key={v.chunkId} style={{ marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => toggle(v.chunkId)}
                aria-expanded={open}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 6,
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: '1px solid var(--pale-stone)',
                  borderRadius: 6,
                  background: 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                <ChevronRight
                  className="w-3.5 h-3.5"
                  style={{
                    flexShrink: 0,
                    marginTop: 2,
                    color: 'var(--lamplight-accent)',
                    transform: open ? 'rotate(90deg)' : 'none',
                    transition: 'transform 120ms ease',
                  }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--lamplight-accent)', fontWeight: 600 }}>
                    {v.sourceLabel}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--silica)', marginTop: 2 }}>
                    {v.heading}
                  </span>
                </span>
              </button>

              {open && (
                <div
                  style={{
                    padding: '8px 10px 4px 30px',
                    fontSize: 12,
                    lineHeight: 1.7,
                    color: 'var(--deep-umber)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {v.content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
