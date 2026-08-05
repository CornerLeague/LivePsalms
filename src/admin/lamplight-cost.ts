// Display-only estimate. Source of truth is provider pricing.
// Update when Voyage or OpenAI adjust rates.
//
// Rates are cents per 1M tokens. The Claude entries are retained deliberately:
// lamplight_usage rows written before the OpenAI switch still carry those model
// ids, and dropping them here would silently report historical spend as $0.
//
// Reasoning tokens: since the Responses API migration, pipelines that run with
// reasoning effort above 'none' (Waymarks at 'high', Study at 'low'/'medium')
// bill their reasoning as OUTPUT tokens, and lamplight_usage.tokens_out already
// includes them. No separate rate is needed — but expect out-token counts on
// those artifact kinds to sit well above their pre-migration baseline.
const PRICE_PER_M_TOKENS_CENTS: Record<string, { in: number; out: number }> = {
  'voyage-3-large':             { in: 18,   out: 0    },  // $0.18 / 1M
  'voyage-context-3':           { in: 18,   out: 0    },  // $0.18 / 1M — cross-check against voyageai.com/pricing at deploy
  'gpt-5.6-luna':               { in: 20,   out: 120  },  // $0.20 / $1.20 — verify against OpenAI pricing page before merge
  'gpt-5.6-terra':              { in: 200,  out: 1200 },  // $2.00 / $12.00
  'gpt-5.6-sol':                { in: 500,  out: 3000 },  // $5.00 / $30.00

  // ── Legacy (pre-OpenAI usage rows; no longer generated) ──
  'claude-haiku-4-5':           { in: 100,  out: 500  },
  'claude-haiku-4-5-20251001':  { in: 100,  out: 500  },
  'claude-sonnet-4-6':          { in: 300,  out: 1500 },
  'claude-sonnet-4-6-20251001': { in: 300,  out: 1500 },
};

export function estCostCents(model: string | null, tokensIn: number, tokensOut: number): number {
  const p = (model && PRICE_PER_M_TOKENS_CENTS[model]) || { in: 0, out: 0 };
  return Math.round((tokensIn * p.in + tokensOut * p.out) / 1_000_000);
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
