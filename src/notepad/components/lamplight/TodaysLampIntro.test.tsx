// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TodaysLampIntro } from './TodaysLampIntro';

afterEach(cleanup);

describe('TodaysLampIntro', () => {
  it('renders the intro copy and start button', () => {
    render(<TodaysLampIntro firstName={null} onStart={() => {}} />);
    expect(screen.getByText(/Today's Lamp draws from your recent notes/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show Me Today's Lamp/i })).toBeInTheDocument();
  });

  it('personalizes the intro with firstName', () => {
    render(<TodaysLampIntro firstName="Natalie" onStart={() => {}} />);
    expect(screen.getByText(/Natalie, Today's Lamp draws/i)).toBeInTheDocument();
  });

  it('calls onStart when the button is tapped', () => {
    const onStart = vi.fn();
    render(<TodaysLampIntro firstName={null} onStart={onStart} />);
    fireEvent.click(screen.getByRole('button', { name: /Show Me Today's Lamp/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('renders the "Your Reflections" CTA directly under the start button when a href is given', () => {
    render(
      <MemoryRouter>
        <TodaysLampIntro firstName={null} onStart={() => {}} reflectionsHref="/notebook/u/reader1/reflections" />
      </MemoryRouter>,
    );
    const startBtn = screen.getByRole('button', { name: /Show Me Today's Lamp/i });
    const cta = screen.getByRole('link', { name: 'Your Reflections' });
    expect(cta).toHaveAttribute('href', '/notebook/u/reader1/reflections');
    expect(startBtn.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits the "Your Reflections" CTA when no href is given', () => {
    render(<TodaysLampIntro firstName={null} onStart={() => {}} />);
    expect(screen.queryByRole('link', { name: 'Your Reflections' })).toBeNull();
  });
});
