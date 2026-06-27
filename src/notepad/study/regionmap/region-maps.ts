// Static, curated, in-repo map data for the Study "Region Map" block.
// No Supabase, no migration, no network fetch. Captions are factual/historical
// only (Lamplight voice — never interpretive or prophetic).

export type MapTab = 'then' | 'now';

// Period-aware region keys. This union holds the keys that are actually sourced
// and shipped; it grows (toward the spec's 12-key target) as art is sourced in
// the asset task. Books whose region is not yet here resolve to null.
export type RegionMapKey = 'judah-monarchy' | 'judea-roman';

export interface MapImage {
  src: string;          // '/maps/judah-monarchy/then.jpg' (served from public/)
  alt: string;          // descriptive alt text
  caption: string;      // factual, non-interpretive
  attribution: string;  // real, verifiable source
  license: string;      // e.g. 'Public Domain', 'CC BY-SA 4.0'
}

export interface RegionMap {
  key: RegionMapKey;
  label: string;        // 'Kingdom of Judah'
  then: MapImage;
  now: MapImage;
}

export const REGION_MAPS: Record<RegionMapKey, RegionMap> = {
  'judah-monarchy': {
    key: 'judah-monarchy',
    label: 'Kingdom of Judah',
    then: {
      src: '/maps/judah-monarchy/then.jpg',
      alt: 'Historical map of the Kingdom of Judah and the route of the Babylonian exile, c. 586 BC.',
      caption: 'The Kingdom of Judah and the route of the exile to Babylon, c. 586 BC.',
      attribution: 'George Adam Smith, Atlas of the Historical Geography of the Holy Land (1915)',
      license: 'Public Domain',
    },
    now: {
      src: '/maps/judah-monarchy/now.jpg',
      alt: 'Modern reference map of the southern Levant: Israel, the West Bank, and western Jordan.',
      caption: 'The same region today — the southern Levant.',
      attribution: 'Wikimedia Commons (modern reference map)',
      license: 'Pending human review',
    },
  },
  'judea-roman': {
    key: 'judea-roman',
    label: 'Roman Judea & Galilee',
    then: {
      src: '/maps/judea-roman/then.jpg',
      alt: 'Historical map of Roman Judea and Galilee in the first century AD.',
      caption: 'Roman Judea and Galilee in the first century AD.',
      attribution: 'George Adam Smith, Atlas of the Historical Geography of the Holy Land (1915)',
      license: 'Public Domain',
    },
    now: {
      src: '/maps/judea-roman/now.jpg',
      alt: 'Modern reference map of Israel, the West Bank, and southern Lebanon.',
      caption: 'The same region today.',
      attribution: 'Wikimedia Commons (modern reference map)',
      license: 'Pending human review',
    },
  },
};
