// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TodaysLampLoading } from './TodaysLampLoading';

afterEach(cleanup);

describe('TodaysLampLoading', () => {
  it('renders notes stage copy', () => {
    render(<TodaysLampLoading stage="notes" firstName={null} />);
    expect(screen.getByText(/Reading your recent notes/i)).toBeInTheDocument();
  });

  it('renders scripture stage copy', () => {
    render(<TodaysLampLoading stage="scripture" firstName={null} />);
    expect(screen.getByText(/Searching Scripture/i)).toBeInTheDocument();
  });

  it('renders composing stage copy (no name)', () => {
    render(<TodaysLampLoading stage="composing" firstName={null} />);
    expect(screen.getByText(/Today's Lamp is on its way/i)).toBeInTheDocument();
  });

  it('renders composing stage copy with firstName prefix', () => {
    render(<TodaysLampLoading stage="composing" firstName="Natalie" />);
    expect(screen.getByText(/Natalie, Today's Lamp is on its way/i)).toBeInTheDocument();
  });

  it('sets aria-live=polite on the status text', () => {
    render(<TodaysLampLoading stage="notes" firstName={null} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});
