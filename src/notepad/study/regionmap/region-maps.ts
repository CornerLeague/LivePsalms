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
      attribution: 'George Adam Smith (ed.) / John Bartholomew & Co. (cart.), Atlas of the Historical Geography of the Holy Land (London: Hodder and Stoughton, 1915). Wikimedia Commons: https://commons.wikimedia.org/wiki/File:Palestine_from_720_BC_to_the_exile_of_Judah_(Smith,_1915).jpg',
      license: 'Public Domain (published 1915)',
    },
    now: {
      // Modern map intentionally not yet shipped: the only candidate sourced so
      // far (a UN "occupied territories" map) was rejected for editorial framing
      // and uncertain licensing. Until a neutral, openly-licensed reference map
      // is sourced + cleared, this binary is absent and the Today tab shows the
      // graceful "Map image unavailable." fallback. See public/maps/ATTRIBUTION.md.
      src: '/maps/judah-monarchy/now.jpg',
      alt: 'Modern reference map of the southern Levant: Israel, the West Bank, and western Jordan.',
      caption: 'The same region today — the southern Levant.',
      attribution: 'Modern reference map — not yet sourced (see public/maps/ATTRIBUTION.md).',
      license: 'Pending human review',
    },
  },
  'judea-roman': {
    key: 'judea-roman',
    label: 'Roman Judea & Galilee',
    then: {
      src: '/maps/judea-roman/then.jpg',
      alt: 'Historical map of Roman Judea and Galilee under Roman procurators, 6–70 AD.',
      caption: 'Palestine under Roman procurators, 6–41 and 44–70 AD.',
      attribution: 'Collins Bartholomew (cart.) / George Adam Smith (ed.), Atlas of the Historical Geography of the Holy Land (London: Hodder and Stoughton, 1915). National Library of Israel (FL36567232). Wikimedia Commons: https://commons.wikimedia.org/wiki/File:John_Bartholomew_%26_Co.,_Palestine_under_Roman_procurators_6_-_41_and_44_-_70_A.D_(FL36567232_3907410).jpg',
      license: 'Public Domain (published 1915)',
    },
    now: {
      // Modern map intentionally not yet shipped (see judah-monarchy.now above
      // and public/maps/ATTRIBUTION.md). Binary absent → graceful fallback.
      src: '/maps/judea-roman/now.jpg',
      alt: 'Modern reference map of Israel, the West Bank, and southern Lebanon.',
      caption: 'The same region today.',
      attribution: 'Modern reference map — not yet sourced (see public/maps/ATTRIBUTION.md).',
      license: 'Pending human review',
    },
  },
};
