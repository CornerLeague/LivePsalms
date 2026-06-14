import type { PostHogConfig } from 'posthog-js';

const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string;
const posthogHost =
  (import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string) || 'https://us.i.posthog.com';

if (!posthogKey) {
  console.warn(
    'PostHog environment variables missing. Product analytics will be disabled.'
  );
}

/** True when a project key is present, so callers can skip mounting the provider. */
export const isPostHogEnabled = Boolean(posthogKey);

export const posthogApiKey = posthogKey;

export const posthogOptions: Partial<PostHogConfig> = {
  api_host: posthogHost,
  // SPA + react-router: capture pageviews on history API changes, not just first load.
  capture_pageview: 'history_change',
  capture_pageleave: true,
  autocapture: true,
};
