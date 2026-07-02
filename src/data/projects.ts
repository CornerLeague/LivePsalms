import type { Project } from '@/types';

/** Warm taupe — used as the default overlay when no colour is available. */
export const FALLBACK_OVERLAY_COLOR = '#8B8378';
export const FALLBACK_SERENITY_COLOR = '#B08A6A';

export const categoryLabel: Record<Project['category'], string> = {
  residential: 'Restoration',
  hospitality: 'Serenity',
};

// Per-image overlay overrides keyed by project id. Consumed by both the
// desktop hover overlay and the mobile tile title fallback. Falls back to
// the shared categoryLabel when no override exists for a given id.
export const overlayLabelById: Record<string, string> = {
  peace: 'Restoration of Peace',
  hope: 'Restoration of Hope',
  strength: 'Restoration of Strength',
  wholeness: 'Restoration of Wholeness',
  purpose: 'Restoration of Purpose',
  connection: 'Restoration of Connection',
  identity: 'Restoration of Identity',
  joy: 'Restoration of Joy',
  forgiveness: 'Serenity of Forgiveness',
  surrender: 'Serenity of Surrender',
  trust: 'Serenity of Trust',
};

// Project entries for the editorial mosaic. Each image under
// public/mid_section is named by its category so it can be wired directly
// into the grid. IDs and display names are derived from the filename.
const restorationImages = [
  'restoration1.webp',
  'restoration3.jpg',
  'restoration5.webp',
  'restoration6.webp',
  'restoration7.webp',
  'restoration8.webp',
  'restoration9.webp',
  'restoration10.webp',
];

const serenityImages = [
  'serenity2.webp',
  'serenity3.webp',
  'serenity5.webp',
];

// Devotional slugs override the default filename-derived id for projects that
// have a written devotion attached. The URL becomes /purpose/<slug> instead of
// /purpose/<filename>.
const idOverrides: Record<string, string> = {
  restoration1: 'peace',
  restoration3: 'hope',
  restoration5: 'strength',
  restoration6: 'wholeness',
  restoration7: 'purpose',
  restoration8: 'connection',
  restoration9: 'identity',
  restoration10: 'joy',
  serenity2: 'forgiveness',
  serenity3: 'surrender',
  serenity5: 'trust',
};

const toProject = (
  file: string,
  category: Project['category'],
  displayName: string,
  overlayColor: string
): Project => {
  const baseId = file.replace(/\.(png|jpg|jpeg|webp)$/i, '');
  const id = idOverrides[baseId] ?? baseId;
  const src = `/mid_section/${file}`;
  return {
    id,
    name: displayName,
    category,
    thumbnail: src,
    images: [src],
    overlayColor,
  };
};

// Per-image solid overlay colours sampled to complement each photograph.
const restorationOverlays = [
  '#8B8378', // warm taupe
  '#7A7568', // grey-brown
  '#A09688', // sand
  '#6E6960', // dark stone
  '#9C9488', // pale clay
  '#8A8070', // muted umber
  '#7D756A', // driftwood
  '#938A7E', // putty
  '#B0A898', // linen
];
const serenityOverlays = [
  '#B08A6A', // warm ochre
  '#C49A78', // terracotta
  '#A8866A', // burnt sienna
  '#BFA080', // dusty coral
  '#C4A488', // sand gold
];

export const projects: Project[] = [
  ...restorationImages.map((file, i) =>
    toProject(file, 'residential', `Restoration ${String(i + 1).padStart(2, '0')}`, restorationOverlays[i] ?? FALLBACK_OVERLAY_COLOR)
  ),
  ...serenityImages.map((file, i) =>
    toProject(file, 'hospitality', `Serenity ${String(i + 1).padStart(2, '0')}`, serenityOverlays[i] ?? FALLBACK_SERENITY_COLOR)
  ),
];

export const navItems = [
  { label: 'Purpose', href: '/purpose' },
  { label: 'Notebook', href: '/notebook' },
  { label: 'Community', href: '/community' },
  { label: 'Contact', href: '/contact' },
];

// Labels whose tap should fire the loading overlay. Social is intentionally
// excluded (it's a hover dropdown, not a navigation). Single source of truth
// imported by HeaderDesktop and HeaderMobile.
export const NAV_TRIGGER_LABELS: ReadonlySet<string> = new Set([
  'Purpose',
  'Notebook',
  'Community',
  'Contact',
]);
