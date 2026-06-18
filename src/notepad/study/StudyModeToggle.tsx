// src/notepad/study/StudyModeToggle.tsx
import { Link, useLocation } from 'react-router-dom';

export function StudyModeToggle() {
  const { pathname } = useLocation();
  const isStudy = pathname.endsWith('/study');
  const base = isStudy ? pathname.slice(0, -'/study'.length) : pathname.replace(/\/$/, '');
  const segStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    fontSize: 11,
    letterSpacing: '0.08em',
    fontFamily: 'Outfit, sans-serif',
    color: active ? 'var(--deep-umber)' : 'var(--silica)',
    background: active ? 'rgba(196,154,120,0.16)' : 'transparent',
    borderRadius: 6,
    textDecoration: 'none',
  });
  return (
    <div role="tablist" aria-label="Notepad mode" style={{ display: 'flex', gap: 2 }}>
      <Link to={base} aria-current={isStudy ? undefined : 'page'} style={segStyle(!isStudy)}>Journal</Link>
      <Link to={`${base}/study`} aria-current={isStudy ? 'page' : undefined} style={segStyle(isStudy)}>Study</Link>
    </div>
  );
}
