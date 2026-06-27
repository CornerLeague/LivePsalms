// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/notepad/components/Editor', () => ({ NotepadEditor: () => <div>editor</div> }));
vi.mock('@/notepad/theme/ThemeToggle', () => ({ ThemeToggle: () => <div>theme</div> }));
vi.mock('@/components/sections/notepad/mobile/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

import { MobileStudyEditorView } from './MobileStudyEditorView';

afterEach(cleanup);

describe('MobileStudyEditorView', () => {
  it('renders the editor and a back control that calls onBack', () => {
    const onBack = vi.fn();
    render(<MobileStudyEditorView onBack={onBack} />);
    expect(screen.getByText('editor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back to study notes/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
