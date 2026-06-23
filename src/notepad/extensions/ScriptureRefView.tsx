import { useContext, useEffect, useId, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import type { ScriptureRefAttrs, ScriptureRefOptions } from './scripture-ref';
import type { BibleTranslation } from '../bible/translations';
import { BiblePrefsContext } from '../bible/prefs/bible-prefs-context';
import './scripture-ref.css';

type FetchVerseText = (
  ref: string,
  opts?: { signal?: AbortSignal; translation?: BibleTranslation },
) => Promise<{ text: string; translation: string; reference: string } | null>;

export interface ScriptureRefCardProps {
  attrs: ScriptureRefAttrs;
  online: boolean;
  activeTranslation: BibleTranslation;
  updateText: (text: string) => void;
  fetchVerseText: FetchVerseText;
}

function refLabel(a: ScriptureRefAttrs): string {
  const range = a.verseEnd ? `${a.verseStart}–${a.verseEnd}` : `${a.verseStart}`;
  return `${a.book} ${a.chapter}:${range}`;
}

// Presentational + behavior, independent of Tiptap for unit testing.
export function ScriptureRefCard({ attrs, online, activeTranslation, updateText, fetchVerseText }: ScriptureRefCardProps) {
  const [collapsed, setCollapsed] = useState(true);
  const verseId = useId();
  // Display state: starts as the captured snapshot; re-flows for the active version.
  const [display, setDisplay] = useState<{ text: string; translation: string }>(
    { text: attrs.text, translation: attrs.translation },
  );
  const filledRef = useRef(false);

  useEffect(() => {
    if (!online) {
      // Offline: fall back to the captured snapshot.
      setDisplay({ text: attrs.text, translation: attrs.translation });
      return;
    }
    const ctrl = new AbortController();

    if (activeTranslation === attrs.translation) {
      // Active version matches the capture. Use the snapshot; lazily fill if empty
      // (legacy/predictive inserts) and persist that fill back to the node once.
      if (attrs.text.trim().length > 0) {
        setDisplay({ text: attrs.text, translation: attrs.translation });
      } else if (!filledRef.current) {
        filledRef.current = true;
        fetchVerseText(refLabel(attrs), { signal: ctrl.signal, translation: activeTranslation })
          .then((r) => { if (r?.text) { updateText(r.text); setDisplay({ text: r.text, translation: r.translation }); } })
          .catch(() => { /* offline/abort — retries on remount */ });
      }
    } else {
      // Active version differs from the capture: re-resolve for DISPLAY only — never
      // write back to node attrs (preserves stored snapshot + undo history).
      fetchVerseText(refLabel(attrs), { signal: ctrl.signal, translation: activeTranslation })
        .then((r) => { if (r?.text) setDisplay({ text: r.text, translation: r.translation }); })
        .catch(() => { setDisplay({ text: attrs.text, translation: attrs.translation }); });
    }
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrs.osis, attrs.text, attrs.translation, activeTranslation, online]);

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
          <span className="scripture-ref-verse__text">{display.text || refLabel(attrs)}</span>
          <span className="scripture-ref-verse__meta">{refLabel(attrs)}{' · '}{display.translation}</span>
        </span>
      )}
    </span>
  );
}

// Tiptap NodeView wrapper: bridges node attrs + options + active version to the card.
export function ScriptureRefNodeView(props: NodeViewProps) {
  const attrs = props.node.attrs as ScriptureRefAttrs;
  const options = props.extension.options as ScriptureRefOptions;
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const fetchVerseText: FetchVerseText =
    options.search?.fetchVerseText ?? (async () => null);
  // Reactive active version. Outside a provider (tests / read-only render) fall back
  // to the mount-frozen option so behavior is unchanged.
  const prefs = useContext(BiblePrefsContext);
  const activeTranslation = prefs?.translation ?? options.translation;

  return (
    <NodeViewWrapper as="span" className="scripture-ref">
      <ScriptureRefCard
        attrs={attrs}
        online={online}
        activeTranslation={activeTranslation}
        fetchVerseText={fetchVerseText}
        updateText={(text) => props.updateAttributes({ text })}
      />
    </NodeViewWrapper>
  );
}
