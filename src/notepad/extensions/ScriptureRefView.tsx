import { useEffect, useId, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import type { ScriptureRefAttrs, ScriptureRefOptions } from './scripture-ref';
import './scripture-ref.css';

type FetchVerseText = (
  ref: string,
  opts?: { signal?: AbortSignal },
) => Promise<{ text: string; translation: string; reference: string } | null>;

export interface ScriptureRefCardProps {
  attrs: ScriptureRefAttrs;
  online: boolean;
  updateText: (text: string) => void;
  fetchVerseText: FetchVerseText;
}

function refLabel(a: ScriptureRefAttrs): string {
  const range = a.verseEnd ? `${a.verseStart}–${a.verseEnd}` : `${a.verseStart}`;
  return `${a.book} ${a.chapter}:${range}`;
}

// Presentational + behavior, independent of Tiptap for unit testing.
export function ScriptureRefCard({ attrs, online, updateText, fetchVerseText }: ScriptureRefCardProps) {
  // Ephemeral, local — never serialized. Default collapsed.
  const [collapsed, setCollapsed] = useState(true);
  const filledRef = useRef(false);
  const verseId = useId();

  useEffect(() => {
    if (filledRef.current) return;
    if (attrs.text.trim().length > 0) return;
    if (!online) return;
    filledRef.current = true;
    const ctrl = new AbortController();
    fetchVerseText(refLabel(attrs), { signal: ctrl.signal })
      .then((r) => { if (r?.text) updateText(r.text); })
      .catch(() => { /* offline/abort — stays empty, retries on remount */ });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrs.osis, online]);

  return (
    <span className={`scripture-ref-inline${collapsed ? '' : ' is-expanded'}`}>
      <button
        type="button"
        className="scripture-ref-link"
        aria-expanded={!collapsed}
        aria-controls={collapsed ? undefined : verseId}
        onClick={() => setCollapsed((c) => !c)}
      >
        {'📖 '}{refLabel(attrs)}
      </button>
      {!collapsed && (
        <span id={verseId} className="scripture-ref-verse">
          <span className="scripture-ref-verse__text">{attrs.text || refLabel(attrs)}</span>
          <span className="scripture-ref-verse__meta">{refLabel(attrs)}{' · '}{attrs.translation}</span>
        </span>
      )}
    </span>
  );
}

// Tiptap NodeView wrapper: bridges node attrs + options to ScriptureRefCard.
export function ScriptureRefNodeView(props: NodeViewProps) {
  const attrs = props.node.attrs as ScriptureRefAttrs;
  const options = props.extension.options as ScriptureRefOptions;
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const fetchVerseText: FetchVerseText =
    options.search?.fetchVerseText ?? (async () => null);

  return (
    <NodeViewWrapper as="span" className="scripture-ref">
      <ScriptureRefCard
        attrs={attrs}
        online={online}
        fetchVerseText={fetchVerseText}
        updateText={(text) => props.updateAttributes({ text })}
      />
    </NodeViewWrapper>
  );
}
