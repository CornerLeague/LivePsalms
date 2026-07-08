// src/components/sections/notepad/StudyWindow.tsx
import { useState, useEffect } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { BibleStudyPane } from '@/notepad/bible/BibleStudyPane';
import type { LamplightAdapter } from '@/notepad/storage/lamplight-adapter';
import type { InvokeFn } from '@/notepad/bible/lamplight-chat-client';
import type { StreamInvoke } from '@/notepad/bible/lamplight-stream-client';
import { GraphPane } from './GraphPane';
import { loadEnum, saveEnum, KEY_STUDY_TAB } from '@/notepad/session/session-storage';
import { registerWorkspaceControls } from '@/notepad/onboarding/tour/workspace-controller';

type StudyTab = 'bible' | 'graph';

interface StudyWindowProps {
  /** Whether the right-hand window is open (reuses the prior graph toggle). */
  graphOpen: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  lamplightAdapter: LamplightAdapter | null;
  invoke: InvokeFn;
  streamInvoke?: StreamInvoke;
}

export function StudyWindow({ graphOpen, expanded = false, onToggleExpand, lamplightAdapter, invoke, streamInvoke }: StudyWindowProps) {
  const [tab, setTab] = useState<StudyTab>(() =>
    loadEnum<StudyTab>(KEY_STUDY_TAB, ['bible', 'graph'], 'bible'),
  );

  useEffect(() => {
    return registerWorkspaceControls({
      desktopSetStudyTab: (next) => setTab(next),
    });
  }, []);

  useEffect(() => {
    saveEnum(KEY_STUDY_TAB, tab);
  }, [tab]);

  const tabStyle = (active: boolean) => ({
    flex: 1,
    textAlign: 'center' as const,
    padding: '11px 0',
    fontSize: 10,
    letterSpacing: '0.18em',
    fontWeight: 600,
    fontFamily: 'Outfit, sans-serif',
    color: active ? 'var(--deep-umber)' : 'var(--silica)',
    background: active ? 'rgba(196,154,120,0.16)' : 'transparent',
    boxShadow: active ? 'inset 0 -2px 0 var(--lamplight-accent)' : 'none',
    cursor: 'pointer',
  });

  return (
    <aside
      className="overflow-hidden border-l flex-col hidden md:flex"
      style={{
        flex: expanded ? '1 1 0%' : graphOpen ? '0 0 35%' : '0 0 0px',
        borderColor: graphOpen ? 'var(--pale-stone)' : 'transparent',
        background: 'var(--notepad-aside-bg)',
        opacity: graphOpen ? 1 : 0,
        transition: 'flex 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
      }}
    >
      {/* tab bar */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--pale-stone)' }} role="tablist">
        <button data-tour="editor-bible-panel" role="tab" aria-selected={tab === 'bible'} onClick={() => setTab('bible')} style={tabStyle(tab === 'bible')}>
          BIBLE
        </button>
        <button data-tour="studywindow-graph-tab" role="tab" aria-selected={tab === 'graph'} onClick={() => setTab('graph')} style={tabStyle(tab === 'graph')}>
          GRAPH
        </button>
      </div>

      {/* body */}
      <div className="flex-1 relative overflow-hidden">
        {tab === 'bible' ? (
          <BibleStudyPane lamplightAdapter={lamplightAdapter} invoke={invoke} streamInvoke={streamInvoke} />
        ) : (
          <GraphPane graphOpen={graphOpen} embedded />
        )}
      </div>

      {/* expand footer */}
      <div className="p-4 shrink-0" style={{ borderTop: '1px solid rgba(206, 204, 202, 0.5)' }}>
        <button onClick={onToggleExpand} className="flex items-center gap-2 w-full justify-center py-2 rounded-md hover:bg-black/5 transition-colors">
          {expanded
            ? <Minimize2 className="w-3.5 h-3.5" style={{ color: 'var(--deep-umber)' }} />
            : <Maximize2 className="w-3.5 h-3.5" style={{ color: 'var(--deep-umber)' }} />}
          <span className="text-[10px] font-medium tracking-widest" style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}>
            {expanded ? 'COLLAPSE' : 'EXPAND'}
          </span>
        </button>
      </div>
    </aside>
  );
}
