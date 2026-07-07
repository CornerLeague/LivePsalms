// Canonical artifact types shared between the Edge Function (Deno) and the
// React client (Node/browser via tsc). Framework-free: no I/O, no Deno or
// Node globals.

export interface DailyDevotion {
  opening: string;
  scripture: {
    ref: string;
    text: string;
  };
  reflection: string;
  prompt: string;
  note_citations: Array<{
    note_id: string;
    reason: string;
  }>;
}

// Waymarks (Reflection Timeline). The model's strict-JSON output for a monthly
// (and, fast-follow, yearly) reflection. Framework-free; re-exported to the
// client via src/notepad/storage/lamplight-artifacts.ts (Task 11).
export interface Marker {
  date: string;         // ISO YYYY-MM-DD, within the period
  date_end?: string;    // ISO YYYY-MM-DD, present only for a span (e.g. a hard week)
  verse: string | null; // exactly one candidate ref, or null (abstention — voice-safe)
  phrase: string;       // Lamplight's own short naming — never a quote from the notes
}

export interface ReflectionArtifact {
  title: string;        // underline-worthy month/year name (spec §2.1)
  letter: string;       // second-person prose that reads whole
  markers: Marker[];    // 1–6 (MARKER_MIN/MAX)
}
