// Types for render.mjs.
//
// The implementation stays plain ESM because `render-emails.mjs` runs it
// directly under node with no build step. This file exists so its TEST — which
// is TypeScript, and is now inside the typecheck — sees real types rather than
// an implicit `any` that swallows every `t` in every callback.

export declare const LOGO_URL: string;

/**
 * One transactional email. `cta`, `code` and `reassurance` are optional because
 * the templates genuinely differ: `password_changed` is a notice with no action,
 * and `reauthentication` shows a code rather than a button.
 */
export interface EmailTemplate {
  /** Matches the Supabase Auth template slug. */
  name: string;
  subject: string;
  preheader: string;
  headline: string;
  body: string;
  cta?: { label: string; url: string };
  code?: string;
  reassurance?: string;
}

/**
 * Build one template's inner content and inject it, the preheader and the logo
 * into the base shell. Pure: same inputs, same output.
 */
export declare function renderEmail(baseHtml: string, template: EmailTemplate): string;

export declare const TEMPLATES: EmailTemplate[];
