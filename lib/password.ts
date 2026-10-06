// Dependency-free so the tests can load it directly.
// Set the same minimum in Supabase (Authentication > Providers > Email > Minimum password length).
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // bcrypt, used by Supabase Auth, ignores bytes beyond 72.

/** The first problem with a new password, as a key of messages.*.auth, or null when it is acceptable. */
export function passwordProblem(password: string): 'passwordTooShort' | 'weakPassword' | null {
  if (Array.from(password).length < PASSWORD_MIN) return 'passwordTooShort';
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) return 'weakPassword';
  return null;
}
