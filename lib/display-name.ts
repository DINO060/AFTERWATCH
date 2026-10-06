// Dependency-free so the tests can load it directly.
export const DISPLAY_NAME_MAX = 40;

/** A display name as shown in the interface: no control or invisible format characters, single spaces, at most 40 characters. */
export function cleanDisplayName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return Array.from(
    value
      // Whitespace (tabs, new lines) becomes a space before other control characters are dropped.
      .replace(/\s+/g, ' ')
      .replace(/[\p{Cc}\p{Cf}]/gu, '')
      .replace(/ {2,}/g, ' ')
      .trim(),
  )
    .slice(0, DISPLAY_NAME_MAX)
    .join('')
    .trim();
}
