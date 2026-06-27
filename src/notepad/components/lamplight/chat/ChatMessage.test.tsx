// @vitest-environment jsdom
// src/notepad/components/lamplight/chat/ChatMessage.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ChatMessage } from './ChatMessage';

afterEach(cleanup);

describe('ChatMessage', () => {
  it('renders user content', () => {
    render(<ChatMessage role="user" content="What does shepherd mean?" citations={[]} />);
    expect(screen.getByText('What does shepherd mean?')).toBeInTheDocument();
  });

  it('renders an assistant reply with a humanized verse citation chip', () => {
    render(<ChatMessage role="assistant" content="The shepherd gives his life." citations={[{ type: 'verse', ref: 'jhn 10:11' }]} />);
    expect(screen.getByText('The shepherd gives his life.')).toBeInTheDocument();
    expect(screen.getByText('John 10:11')).toBeInTheDocument();
  });

  it('renders a note citation as the resolved note title, not the raw id', () => {
    render(
      <ChatMessage
        role="assistant"
        content="Builds on your earlier thought."
        citations={[{ type: 'note', ref: '9fde36a1-3666-4149-8fb2-530fe804c310' }]}
        resolveNoteTitle={(id) => (id === '9fde36a1-3666-4149-8fb2-530fe804c310' ? 'On the Good Shepherd' : undefined)}
      />,
    );
    expect(screen.getByText('On the Good Shepherd')).toBeInTheDocument();
    expect(screen.queryByText(/9fde36a1/)).not.toBeInTheDocument();
  });

  it('falls back to "Note" when a note title cannot be resolved', () => {
    render(
      <ChatMessage
        role="assistant"
        content="Builds on a now-deleted note."
        citations={[{ type: 'note', ref: 'b35ae0bc-33e7-4e52-a28f-d2efe4f67e45' }]}
        resolveNoteTitle={() => undefined}
      />,
    );
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.queryByText(/b35ae0bc/)).not.toBeInTheDocument();
  });

  it('falls back to "Note" for a note citation when no resolver is provided', () => {
    render(
      <ChatMessage
        role="assistant"
        content="No resolver supplied."
        citations={[{ type: 'note', ref: 'b35ae0bc-33e7-4e52-a28f-d2efe4f67e45' }]}
      />,
    );
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.queryByText(/b35ae0bc/)).not.toBeInTheDocument();
  });

  // --- streaming affordance ---

  it('shows stage narration "Reading your recent notes…" when streaming + empty content + stage=notes', () => {
    render(<ChatMessage role="assistant" content="" citations={[]} streaming stage="notes" />);
    expect(screen.getByText('Reading your recent notes…')).toBeInTheDocument();
  });

  it('appends an in-progress caret when streaming + non-empty content', () => {
    render(<ChatMessage role="assistant" content="The shepherd" citations={[]} streaming stage={null} />);
    expect(screen.getByText('The shepherd')).toBeInTheDocument();
    const caret = screen.getByTestId('streaming-caret');
    expect(caret.textContent).toContain('▍');
  });

  it('renders neither narration nor caret and does not crash when streaming + empty content + stage=null', () => {
    render(<ChatMessage role="assistant" content="" citations={[]} streaming stage={null} />);
    expect(screen.queryByText('Reading your recent notes…')).not.toBeInTheDocument();
  });
});
