// Dependency-free so the security tests can load it directly; callers pass the translated message.
export function assertSameOrigin(
  request: Request,
  message = 'This request must come from Afterwatch.',
): void {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    throw Response.json(
      { error: message },
      {
        status: 403,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
