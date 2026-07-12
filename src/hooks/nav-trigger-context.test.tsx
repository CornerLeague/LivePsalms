// @vitest-environment jsdom
// src/hooks/nav-trigger-context.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NavTriggerContext, useNavTrigger } from './nav-trigger-context';

afterEach(cleanup);

function Probe() {
  const trigger = useNavTrigger();
  return <button onClick={trigger}>go</button>;
}

describe('useNavTrigger', () => {
  it('is a no-op (does not throw) when no provider is present', () => {
    render(<Probe />);
    expect(() => fireEvent.click(screen.getByText('go'))).not.toThrow();
  });

  it('returns the provided trigger inside a provider', () => {
    const fn = vi.fn();
    render(
      <NavTriggerContext.Provider value={fn}>
        <Probe />
      </NavTriggerContext.Provider>,
    );
    fireEvent.click(screen.getByText('go'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
