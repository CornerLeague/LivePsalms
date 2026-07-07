// Type-only re-export from the canonical artifact definition in the supabase
// functions tree. The relative path keeps the type single-sourced without
// requiring a tsconfig path alias.

export type { DailyDevotion } from '../../../supabase/functions/_shared/artifacts';
// Waymarks (Task 11): monthly reflection artifact shape + its marker, mirroring DailyDevotion.
export type { ReflectionArtifact, Marker } from '../../../supabase/functions/_shared/artifacts';
