// The Sources screen (depth-overhaul slice 1d, design decision 12).
//
// This is a LICENCE-COMPLIANCE surface, not polish. CC BY requires visible
// credit for OpenBible.info and STEPBible, and `library_sources.attribution` is
// the render-ready credit line the ingest recorded for exactly this purpose —
// so it is printed verbatim, never reformatted, abbreviated, or linkified into
// something else. It doubles as the trust story: this is where a reader sees
// whose study the app is drawing on.

import { useEffect, useState, type CSSProperties } from 'react';
import type { LamplightAdapter, LibrarySource } from '@/notepad/storage/lamplight-adapter';

export interface SourcesSectionProps {
  adapter: LamplightAdapter;
  sectionStyle?: CSSProperties;
  labelStyle?: CSSProperties;
}

export function SourcesSection({ adapter, sectionStyle, labelStyle }: SourcesSectionProps) {
  const [sources, setSources] = useState<LibrarySource[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    adapter.getLibrarySources()
      // A failed read degrades to the empty state: the corpus is reference
      // material, and a settings page must not break because it is unreachable.
      .then((rows) => { if (!cancelled) setSources(rows); })
      .catch(() => { if (!cancelled) setSources([]); });
    return () => { cancelled = true; };
  }, [adapter]);

  const byLicence = new Map<string, LibrarySource[]>();
  for (const s of sources ?? []) {
    const group = byLicence.get(s.license) ?? [];
    group.push(s);
    byLicence.set(s.license, group);
  }

  return (
    <div style={sectionStyle}>
      <p style={labelStyle}>SOURCES</p>

      {sources === null ? null : sources.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--silica)' }}>
          No sources yet.
        </p>
      ) : (
        <>
          <p className="text-sm mb-4" style={{ color: 'var(--silica)' }}>
            Lamplight draws on these works when it studies a passage with you.
          </p>
          {[...byLicence.entries()].map(([licence, group]) => (
            <div key={licence} className="mb-5">
              <div
                className="text-[11px] mb-2 uppercase tracking-wider"
                style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
              >
                {licence}
              </div>
              <ul className="list-none p-0 m-0 space-y-3">
                {group.map((s) => (
                  <li key={s.id}>
                    <div className="text-sm" style={{ color: 'var(--deep-umber)' }}>
                      {s.title} — {s.author}, {s.era}
                    </div>
                    {/* Verbatim. This line IS the licence compliance. */}
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--silica)' }}>
                      {s.attribution}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
