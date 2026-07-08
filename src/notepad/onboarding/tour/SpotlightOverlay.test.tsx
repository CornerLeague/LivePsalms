// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { SpotlightOverlay, computeCardPosition } from './SpotlightOverlay';
import type { TourStep } from './tour-engine';

afterEach(cleanup);

const FIXTURE_STEPS: TourStep[] = [
  {
    id: 'welcome',
    placement: 'center',
    copy: { title: 'The first page is open.', body: 'A short walk.' },
    anchor: () => null,
  },
  {
    id: 'middle',
    placement: 'center',
    copy: { title: 'Middle moment.', body: { desktop: 'Desktop body.', mobile: 'Mobile body.' } },
    anchor: () => null,
  },
  {
    id: 'finale',
    placement: 'center',
    copy: { title: 'Make it yours.', body: 'Closing.' },
    anchor: () => null,
  },
];

function renderOverlay(overrides: Partial<Parameters<typeof SpotlightOverlay>[0]> = {}) {
  const props = {
    steps: FIXTURE_STEPS,
    onComplete: vi.fn(),
    onSkip: vi.fn(),
    onSignUp: vi.fn(),
    ...overrides,
  };
  render(<SpotlightOverlay {...props} />);
  return props;
}

describe('computeCardPosition', () => {
  const card = { width: 300, height: 200 };
  const viewportSize = { width: 1000, height: 800 };

  it('centers the card when there is no target rect', () => {
    expect(computeCardPosition(null, 'center', card, viewportSize)).toEqual({ x: 350, y: 300 });
  });

  it('places the card below a bottom-placed target, horizontally centered', () => {
    const rect = { x: 400, y: 100, width: 200, height: 50 };
    expect(computeCardPosition(rect, 'bottom', card, viewportSize)).toEqual({ x: 350, y: 166 });
  });

  it('clamps to the viewport edge padding', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    const pos = computeCardPosition(rect, 'left', card, viewportSize);
    expect(pos.x).toBe(16);
    expect(pos.y).toBe(16);
  });
});

describe('SpotlightOverlay', () => {
  it('shows the welcome step with its entry buttons and progress', async () => {
    renderOverlay();
    expect(await screen.findByText('The first page is open.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take the walk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    expect(screen.getByLabelText('Step 1 of 3')).toBeInTheDocument();
  });

  it('advances with the primary button and resolves per-viewport copy (desktop default)', async () => {
    renderOverlay();
    await userEvent.click(await screen.findByRole('button', { name: 'Take the walk' }));
    expect(await screen.findByText('Middle moment.')).toBeInTheDocument();
    expect(screen.getByText('Desktop body.')).toBeInTheDocument();
  });

  it('Escape skips: plays the exit then calls onSkip exactly once', async () => {
    const props = renderOverlay();
    await screen.findByText('The first page is open.');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(props.onSkip).toHaveBeenCalledTimes(1));
    expect(props.onComplete).not.toHaveBeenCalled();
  });

  it('arrow keys navigate back and forward', async () => {
    renderOverlay();
    await screen.findByText('The first page is open.');
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByText('Middle moment.')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowLeft}');
    expect(await screen.findByText('The first page is open.')).toBeInTheDocument();
  });

  it('final step: CTA fires onSignUp after the exit', async () => {
    const props = renderOverlay();
    await userEvent.click(await screen.findByRole('button', { name: 'Take the walk' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create free account' }));
    await waitFor(() => expect(props.onSignUp).toHaveBeenCalledTimes(1));
    expect(props.onComplete).not.toHaveBeenCalled();
  });

  it('final step: the secondary button completes the tour', async () => {
    const props = renderOverlay();
    await userEvent.click(await screen.findByRole('button', { name: 'Take the walk' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Not yet — keep exploring' }));
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
  });

  it('skips a step forward when its anchor cannot resolve', async () => {
    const steps: TourStep[] = [
      FIXTURE_STEPS[0],
      { id: 'broken', placement: 'bottom', copy: { title: 'Broken.', body: 'x' }, anchor: () => 'missing-token' },
      FIXTURE_STEPS[2],
    ];
    renderOverlay({ steps, resolveAnchor: async () => null });
    await userEvent.click(await screen.findByRole('button', { name: 'Take the walk' }));
    expect(await screen.findByText('Make it yours.')).toBeInTheDocument();
  });
});
