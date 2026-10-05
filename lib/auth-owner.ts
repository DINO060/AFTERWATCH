// Reject a save prepared for a different account after a session/cookie switch.
// Dependency-free so the security tests can load it directly; callers pass the translated message.
export function assertExpectedUser(
  expectedUserId: unknown,
  verifiedUserId: string,
  message = 'Your account changed. Reload before saving your collection.',
): void {
  if (typeof expectedUserId !== 'string' || expectedUserId !== verifiedUserId) {
    throw Response.json(
      { error: message },
      {
        status: 409,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
