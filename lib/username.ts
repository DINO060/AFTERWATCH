// Public usernames, shown to other members. Same rules as public.set_username in
// supabase/migrations/202610080001_public_profiles.sql. Dependency-free so the tests can load it.
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** Names that could pass for the site or its team. */
const RESERVED = new Set([
  'aide',
  'api',
  'bot',
  'contact',
  'equipe',
  'help',
  'null',
  'officiel',
  'official',
  'root',
  'staff',
  'support',
  'system',
  'team',
  'undefined',
]);
const RESERVED_PREFIX = /^(afterwatch|admin|modo|moder)/;

export type UsernameProblem = 'usernameLength' | 'usernameChars' | 'usernameEdges' | 'usernameReserved';

/** Usernames are compared and stored in lower case, without surrounding spaces. */
export const normalizeUsername = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export function usernameProblem(value: string): UsernameProblem | null {
  const name = normalizeUsername(value);
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return 'usernameLength';
  if (!/^[a-z0-9._]+$/.test(name)) return 'usernameChars';
  if (!/^[a-z0-9].*[a-z0-9]$/.test(name) || /[._]{2}/.test(name)) return 'usernameEdges';
  if (RESERVED.has(name) || RESERVED_PREFIX.test(name)) return 'usernameReserved';
  return null;
}
