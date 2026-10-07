// Dependency-free so the tests can load it.
/** The word typed to confirm an account deletion, in either language. */
const DELETE_WORDS = ['SUPPRIMER', 'DELETE'];
export const confirmsDeletion = (value: unknown) =>
  typeof value === 'string' && DELETE_WORDS.includes(value.trim().toUpperCase());
