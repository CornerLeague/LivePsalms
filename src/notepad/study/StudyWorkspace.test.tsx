// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('./panes/ApparatusRail', () => ({ ApparatusRail: () => <div>rail</div> }));
vi.mock('./panes/StudyReader', () => ({ StudyReader: () => <div>reader</div> }));
vi.mock('./panes/LamplightStudyPanel', () => ({ LamplightStudyPanel: () => <div>panel</div> }));
// useAuthSession returns { user, loading, session, adapter } — userId is user?.id
vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => ({ user: { id: 'u1' }, loading: false }) }));

import { StudyWorkspace } from './StudyWorkspace';

describe('StudyWorkspace', () => {
  it('renders three panes under data-mode="study"', () => {
    const { container } = render(<StudyWorkspace />);
    const root = container.querySelector('[data-mode="study"]');
    expect(root).toBeTruthy();
    expect(root?.textContent).toContain('rail');
    expect(root?.textContent).toContain('reader');
    expect(root?.textContent).toContain('panel');
  });
});
