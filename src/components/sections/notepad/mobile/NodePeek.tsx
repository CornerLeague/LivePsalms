import type { ReactNode } from 'react';
import { ChevronLeft, BookOpen, Crosshair } from 'lucide-react';
import type { PeekData } from './node-peek-data';

export interface NodePeekProps {
  data: PeekData;
  onBack: () => void;
  onOpenInEditor: (id: string) => void;
  onFocus: (id: string) => void;
  onPeekNote: (id: string) => void;
}

// Mirror desktop GraphPane's NODE_COLORS — CSS vars that flip to the lifted
// dark palette (see --graph-node-* in index.css) instead of frozen light hex.
const TYPE_COLORS: Record<string, string> = {
  scripture: 'var(--graph-node-scripture)',
  sermon: 'var(--graph-node-sermon)',
  devotion: 'var(--graph-node-devotion)',
  theme: 'var(--graph-node-theme)',
  general: 'var(--graph-node-general)',
};

export function NodePeek({ data, onBack, onOpenInEditor, onFocus, onPeekNote }: NodePeekProps) {
  return (
    <div className="flex flex-col h-full min-h-0" style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--deep-umber)' }}>
      {/* Header — back only; "Open in Editor" lives in the footer (single instance). */}
      <div className="flex items-center px-4 py-3 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-[12px] font-semibold"
          style={{ color: 'var(--deep-umber)' }}
        >
          <ChevronLeft className="w-4 h-4" />
          Back to graph
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2">
        {data.kind === 'note' ? (
          <>
            <h2 className="text-[18px] font-bold mb-2">{data.title}</h2>
            <div className="flex flex-wrap gap-2 mb-3">
              <Chip color={TYPE_COLORS[data.noteType] ?? 'var(--graph-node-general)'}>{data.noteType}</Chip>
              <Chip color="var(--silica)">{data.connectionCount} connections</Chip>
            </div>
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'rgba(var(--deep-umber-rgb), 0.85)' }}>
              {data.preview || 'This note is empty.'}
            </p>
            {data.linkedVerses.length > 0 && (
              <div className="mt-4">
                <div className="text-[10px] tracking-[0.1em] uppercase mb-2" style={{ color: 'var(--silica)' }}>
                  Linked verses
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.linkedVerses.map((v) => (
                    <span
                      key={v.id}
                      className="text-[11px] px-2 py-1 rounded"
                      style={{ background: 'var(--peek-scripture-wash)', color: 'var(--peek-scripture)' }}
                    >
                      {v.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <h2 className="text-[18px] font-bold mb-1" style={{ color: 'var(--peek-scripture)' }}>{data.reference}</h2>
            <div className="text-[10px] tracking-[0.08em] mb-3" style={{ color: 'var(--silica)' }}>
              {data.translation}
            </div>
            <p className="text-[14px] italic leading-relaxed mb-5" style={{ color: 'rgba(var(--deep-umber-rgb), 0.9)' }}>
              {data.text || 'Verse text unavailable.'}
            </p>
            <div className="text-[10px] tracking-[0.1em] uppercase mb-2" style={{ color: 'var(--silica)' }}>
              Referenced by
            </div>
            {data.referencedBy.length === 0 ? (
              <p className="text-[12px]" style={{ color: 'var(--silica)' }}>No notes reference this verse yet.</p>
            ) : (
              <div className="flex flex-col">
                {data.referencedBy.map((n) => (
                  <button
                    type="button"
                    key={n.id}
                    onClick={() => onPeekNote(n.id)}
                    className="flex items-center gap-2 py-2 text-left"
                    style={{ borderTop: '1px solid var(--pale-stone)' }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: TYPE_COLORS[n.type] ?? 'var(--graph-node-general)' }} />
                    <span className="text-[13px]">{n.title}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-4 py-3 flex gap-2" style={{ borderTop: '1px solid color-mix(in srgb, var(--pale-stone) 50%, transparent)' }}>
        <button
          type="button"
          onClick={() => onFocus(data.id)}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[12px] font-semibold"
          style={{ border: '1px solid var(--deep-umber)', color: 'var(--deep-umber)' }}
        >
          <Crosshair className="w-3.5 h-3.5" />
          Focus in graph
        </button>
        {data.kind === 'note' && (
          <button
            type="button"
            onClick={() => onOpenInEditor(data.id)}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[12px] font-semibold"
            style={{ background: 'var(--deep-umber)', color: 'var(--plaster)' }}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Open in Editor
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="text-[10px] px-2 py-1 rounded-full" style={{ border: `1px solid ${color}`, color }}>
      {children}
    </span>
  );
}
