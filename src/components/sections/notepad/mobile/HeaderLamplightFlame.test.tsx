// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HeaderLamplightFlame } from './HeaderLamplightFlame';

afterEach(cleanup);

describe('<HeaderLamplightFlame />', () => {
  it('shows the arrival dot only when lamplightHasArrived is true', () => {
    const { container, rerender } = render(<HeaderLamplightFlame lamplightHasArrived={false} />);
    expect(container.querySelector('[data-testid="lamplight-arrival-dot"]')).toBeNull();

    rerender(<HeaderLamplightFlame lamplightHasArrived />);
    expect(container.querySelector('[data-testid="lamplight-arrival-dot"]')).not.toBeNull();
  });
});
