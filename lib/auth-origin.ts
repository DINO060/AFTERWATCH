export function assertSameOrigin(request: Request): void {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    throw Response.json({ error: 'Cette requête doit être envoyée depuis Afterwatch.' }, {
      status: 403,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
