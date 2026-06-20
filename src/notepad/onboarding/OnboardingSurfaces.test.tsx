// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LoadingOverlayContext } from '@/hooks/loading-overlay-context';
import { OnboardingSurfaces } from './OnboardingSurfaces';

const ctx = vi.fn();
vi.mock('./useOnboarding', () => ({ useOnboarding: () => ctx() }));

afterEach(cleanup);

describe('OnboardingSurfaces', () => {
  it('renders the get-started checklist when action present', () => {
    ctx.mockReturnValue({
      actions: [{ kind: 'show-get-started' }],
      anon: { items: {}, dismissed: false }, account: null,
      reportOnboardingEvent: vi.fn(), completeGuidedNote: vi.fn(),
      dismissChecklist: vi.fn(), replayTour: vi.fn(), markTourDone: vi.fn(),
    });
    render(<OnboardingSurfaces />);
    expect(screen.getByText(/get started/i)).toBeInTheDocument();
  });

  it('renders nothing while the loading overlay is visible, even with an action', () => {
    ctx.mockReturnValue({
      actions: [{ kind: 'show-get-started' }],
      anon: { items: {}, dismissed: false }, account: null,
      reportOnboardingEvent: vi.fn(), completeGuidedNote: vi.fn(),
      dismissChecklist: vi.fn(), replayTour: vi.fn(), markTourDone: vi.fn(),
    });
    const { container } = render(
      <LoadingOverlayContext.Provider value={true}>
        <OnboardingSurfaces />
      </LoadingOverlayContext.Provider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the checklist once the loading overlay is gone', () => {
    ctx.mockReturnValue({
      actions: [{ kind: 'show-get-started' }],
      anon: { items: {}, dismissed: false }, account: null,
      reportOnboardingEvent: vi.fn(), completeGuidedNote: vi.fn(),
      dismissChecklist: vi.fn(), replayTour: vi.fn(), markTourDone: vi.fn(),
    });
    render(
      <LoadingOverlayContext.Provider value={false}>
        <OnboardingSurfaces />
      </LoadingOverlayContext.Provider>,
    );
    expect(screen.getByText(/get started/i)).toBeInTheDocument();
  });

  it('renders nothing when actions is empty', () => {
    ctx.mockReturnValue({
      actions: [], anon: null, account: null,
      reportOnboardingEvent: vi.fn(), completeGuidedNote: vi.fn(),
      dismissChecklist: vi.fn(), replayTour: vi.fn(), markTourDone: vi.fn(),
    });
    const { container } = render(<OnboardingSurfaces />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the journey checklist for show-journey', () => {
    ctx.mockReturnValue({
      actions: [{ kind: 'show-journey' }],
      anon: null, account: { guidedNote: 'done', items: {}, dismissed: false, studyDates: [], merged: true },
      reportOnboardingEvent: vi.fn(), completeGuidedNote: vi.fn(),
      dismissChecklist: vi.fn(), replayTour: vi.fn(), markTourDone: vi.fn(),
    });
    render(<OnboardingSurfaces />);
    expect(screen.getByText(/your journey/i)).toBeInTheDocument();
  });

  it('renders the guided-note offer and skips with completeGuidedNote("skipped")', () => {
    const completeGuidedNote = vi.fn();
    ctx.mockReturnValue({
      actions: [{ kind: 'offer-guided-note' }],
      anon: null, account: null,
      reportOnboardingEvent: vi.fn(), completeGuidedNote,
      dismissChecklist: vi.fn(), replayTour: vi.fn(), markTourDone: vi.fn(),
    });
    render(<OnboardingSurfaces onStartGuidedNote={vi.fn()} />);

    expect(screen.getByRole('button', { name: /start guided note/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(completeGuidedNote).toHaveBeenCalledWith('skipped');
  });
});
