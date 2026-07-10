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

  it('renders a "Your Reflections" link to the reflections path when reflectionsHref is set', () => {
    render(
      <MemoryRouter>
        <TodaysLampIntro firstName={null} onStart={() => {}} reflectionsHref="/notebook/u/nat/reflections" />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Your Reflections' });
    expect(link).toHaveAttribute('href', '/notebook/u/nat/reflections');
  });

  it('omits the "Your Reflections" link when reflectionsHref is absent', () => {
    render(<TodaysLampIntro firstName={null} onStart={() => {}} />);
    expect(screen.queryByRole('link', { name: 'Your Reflections' })).toBeNull();
  });
});
