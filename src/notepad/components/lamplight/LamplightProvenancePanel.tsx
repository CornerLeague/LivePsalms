// "How this was written" — the transparency surface for a Lamplight artifact
// (backlog P2-2, depth-overhaul slice 1d).
//
// Reassurance ON DEMAND: a closed disclosure by default, because a reader who
// trusts the devotion should not have to scroll past its bibliography, and a
// reader who doesn't should be one click from the whole picture. Provenance is
// fetched when it opens, not when the card renders.

import { useCallback, useEffect, useState } from 'react';
import type {
  ArtifactProvenance,
  LamplightAdapter,
  LibrarySource,
} from '../../storage/lamplight-adapter';

export interface LamplightProvenancePanelProps {
  adapter: LamplightAdapter;
  userId: string;
  artifactType: string;
  periodKey: string;
}

const LABEL_STYLE: React.CSSProperties = {
  color: 'var(--silica)',
  fontFamily: 'Outfit, sans-serif',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] mb-1.5 uppercase tracking-wider" style={LABEL_STYLE}>
        {title}
      </div>
      {children}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="text-[13px] leading-relaxed list-none p-0 m-0" style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}>
      {items.map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}
    </ul>
  );
}

export function LamplightProvenancePanel({
  adapter, userId, artifactType, periodKey,
}: LamplightProvenancePanelProps) {
  const [open, setOpen] = useState(false);
  const [provenance, setProvenance] = useState<ArtifactProvenance | null>(null);
  const [noteTitles, setNoteTitles] = useState<Map<string, string>>(new Map());
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [missing, setMissing] = useState(false);

  // The row is read up front (it decides whether the trigger renders at all);
  // note titles and source labels wait until someone actually opens the panel.
  useEffect(() => {
    let cancelled = false;
    adapter.getArtifactProvenance(userId, artifactType, periodKey)
      .then((prov) => {
        if (cancelled) return;
        if (!prov) { setMissing(true); return; }
        setProvenance(prov);
      })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [adapter, userId, artifactType, periodKey]);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (!next || !provenance) return;
    const [titles, librarySources] = await Promise.all([
      adapter.resolveNoteTitles(provenance.noteIds).catch(() => new Map<string, string>()),
      provenance.librarySources ? adapter.getLibrarySources().catch(() => []) : Promise.resolve([]),
    ]);
    setNoteTitles(titles);
    setSources(librarySources);
  }, [open, provenance, adapter]);

  if (missing || !provenance) return null;

  // Composed here rather than stored, mirroring composeSourceLabel in the edge
  // runtime. A source that has since been removed from the registry falls back
  // to its id — a raw id is ugly, but a blank line is a lie.
  const labelFor = (sourceId: string) => {
    const s = sources.find((x) => x.id === sourceId);
    return s ? `${s.title} · ${s.author}, ${s.era}` : sourceId;
  };

  const titleFor = (id: string) => noteTitles.get(id) ?? '(untitled)';

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="text-[11px] uppercase tracking-wider bg-transparent border-0 p-0 cursor-pointer"
        style={LABEL_STYLE}
      >
        {open ? '▾' : '▸'} How this was written
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--pale-stone)' }}>
          {provenance.noteIds.length > 0 && (
            <Section title="Drawn from your notes">
              <List items={provenance.noteIds.map(titleFor)} />
            </Section>
          )}

          {provenance.verses.length > 0 && (
            <Section title="Scripture">
              <List items={provenance.verses} />
            </Section>
          )}

          {/* Omitted ENTIRELY when null — "the library never ran" must not
              render as an empty header. */}
          {provenance.librarySources && provenance.librarySources.length > 0 && (
            <Section title="Voices from the church's study">
              <List items={provenance.librarySources.map((c) => `${labelFor(c.sourceId)} — ${c.heading}`)} />
            </Section>
          )}

          <div className="text-[11px] mt-4" style={{ ...LABEL_STYLE, opacity: 0.75 }}>
            {[provenance.modelUsed, provenance.promptVersion].filter(Boolean).join(' · ')}
          </div>
        </div>
      )}
    </div>
  );
}
