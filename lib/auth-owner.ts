// Reject a save prepared for a different account after a session/cookie switch.
export function assertExpectedUser(expectedUserId: unknown, verifiedUserId: string): void {
  if (typeof expectedUserId !== 'string' || expectedUserId !== verifiedUserId) {
    throw Response.json(
      { error: 'Le compte a changé. Recharge avant de sauvegarder ta collection.' },
      {
        status: 409,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
