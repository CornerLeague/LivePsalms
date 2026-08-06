// src/notepad/study/insights/LibraryVoices.tsx
// "Voices from the Church's Study" — the class-B section of the Insights
// Reference door. Every word on screen is quoted corpus text with a named
// source; nothing here is generated, so nothing here can be hallucinated.
//
// GROUPED BY SOURCE, not one card per chunk. At chapter scope every verse-level
// chunk in the chapter overlaps, and the commentaries are verse-keyed — John 1
// alone yields 45 JFB notes. Rendered flat that is a wall of near-identical
// headings; grouped, it reads the way the section is named: a short list of
// voices, each of which can be opened. (Server-side the same problem is solved
// by semantic ranking + top-k, which the client has no embedding for.)
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

interface VoiceGroup {
  sourceId: string;
  sourceLabel: string;
  tradition: string;
  notes: LibraryVoice[];
}

/** Groups preserve first-appearance order, which useLibraryVoices already sorted. */
function groupBySource(voices: LibraryVoice[]): VoiceGroup[] {
  const groups = new Map<string, VoiceGroup>();
  for (const v of voices) {
    const existing = groups.get(v.sourceId);
    if (existing) existing.notes.push(v);
    else groups.set(v.sourceId, { sourceId: v.sourceId, sourceLabel: v.sourceLabel, tradition: v.tradition, notes: [v] });
  }
  return [...groups.values()];
}

export function LibraryVoices({ voices, loading }: LibraryVoicesProps) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());

  // Absent, not empty. A chapter nobody commented on gets no heading, no
  // placeholder, and no apology — same for the loading window, which would
  // otherwise flash a heading over nothing.
  if (loading || voices.length === 0) return null;

  const groups = groupBySource(voices);
  const traditions = [...new Set(voices.map((v) => v.tradition).filter(Boolean))];

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--silica)', margin: '0 0 8px' }}>
        VOICES FROM THE CHURCH&apos;S STUDY
      </h3>
      <p style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--silica)', margin: '0 0 12px' }}>
        In the library so far: {traditions.join(' · ')}. More traditions join this section as their
        sources are licensed.
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {groups.map((g) => {
          const open = openIds.has(g.sourceId);
          return (
            <li key={g.sourceId} style={{ marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => toggle(g.sourceId)}
                aria-expanded={open}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 6, width: '100%',
                  textAlign: 'left', padding: '10px 12px',
                  border: '1px solid var(--pale-stone)', borderRadius: 6,
                  background: 'transparent', cursor: 'pointer', fontFamily: 'Outfit, sans-serif',
                }}
              >
                <ChevronRight
                  className="w-3.5 h-3.5"
                  style={{
                    flexShrink: 0, marginTop: 2, color: 'var(--lamplight-accent)',
                    transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease',
                  }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--lamplight-accent)', fontWeight: 600 }}>
                    {g.sourceLabel}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--silica)', marginTop: 2 }}>
                    {g.notes.length} note{g.notes.length === 1 ? '' : 's'} on this passage
                  </span>
                </span>
              </button>

              {open && (
                <div style={{ padding: '10px 12px 4px 30px' }}>
                  {g.notes.map((n) => (
                    <div key={n.chunkId} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, color: 'var(--silica)', marginBottom: 3 }}>{n.heading}</div>
                      <div
                        style={{
                          fontSize: 12, lineHeight: 1.7, color: 'var(--deep-umber)',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {n.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
