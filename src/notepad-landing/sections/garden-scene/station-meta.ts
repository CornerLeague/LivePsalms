// src/notepad-landing/sections/garden-scene/station-meta.ts

export interface StationMeta {
  readonly index: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  readonly slug: string;                 // for id="section-XX" anchors
  readonly name: string;                 // displayed in aria-label and (optionally) tooltip
  readonly roman: string;                // 'I'..'VII' for the progress indicator
  readonly baseVh: 125;                  // every station's base allotment
  readonly extraVh: number;              // 0 except list stations
  readonly itemCount: number;            // 1 for non-list; 7 or 8 for list stations
}

export const STATION_META: readonly StationMeta[] = [
  { index: 0, slug: 'section-02', name: 'Three Voices',       roman: 'I',   baseVh: 125, extraVh:  0, itemCount: 1 },
  { index: 1, slug: 'section-03', name: 'Living Graph',       roman: 'II',  baseVh: 125, extraVh:  0, itemCount: 1 },
  { index: 2, slug: 'section-04', name: 'Connections',          roman: 'III', baseVh: 125, extraVh:  0, itemCount: 1 },
  { index: 3, slug: 'section-05', name: 'Scripture Margin',   roman: 'IV',  baseVh: 125, extraVh:  0, itemCount: 1 },
  { index: 4, slug: 'section-06', name: 'Seven Papers',       roman: 'V',   baseVh: 125, extraVh: 35, itemCount: 7 },
  { index: 5, slug: 'section-07', name: 'Tier Path',          roman: 'VI',  baseVh: 125, extraVh: 40, itemCount: 8 },
  { index: 6, slug: 'section-08', name: 'Yours, Stays Yours', roman: 'VII', baseVh: 125, extraVh:  0, itemCount: 1 },
] as const;

export const TOTAL_SPACER_VH: number = STATION_META.reduce(
  (sum, s) => sum + s.baseVh + s.extraVh,
  0,
); // 7 * 125 + 35 + 40 = 950
