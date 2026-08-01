/**
 * Canonical link target for the Reflections path page.
 *
 * Signed-in readers with a resolved username get the vanity mount
 * (/notebook/u/:username/reflections — where App.tsx actually mounts
 * WaymarksReflectionsRoute). Before the username has loaded we fall back to the
 * legacy /notebook/reflections path, which LegacyReflectionsRedirect forwards to
 * the vanity mount rather than a dead end. This is the same seam LamplightTabPanel
 * used before the Reflections entry points were promoted out of the Lamplight card
 * into their own top-level doors (desktop toolbar + mobile tab bar).
 */
export function reflectionsPath(username: string | null | undefined): string {
  return username ? `/notebook/u/${username}/reflections` : '/notebook/reflections';
}
