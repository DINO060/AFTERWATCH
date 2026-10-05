export function safeReturnPath(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  try {
    const parsed = new URL(value, 'https://afterwatch.local');
    if (
      parsed.origin !== 'https://afterwatch.local' ||
      parsed.pathname.startsWith('/auth/') ||
      parsed.pathname.startsWith('/api/auth/')
    )
      return '/';
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    // Dot segments can normalize '/.//host' to '//host', which browsers treat as another origin.
    return path.startsWith('//') ? '/' : path;
  } catch {
    return '/';
  }
}
