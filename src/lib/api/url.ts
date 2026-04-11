const DEFAULT_APP_URL = 'https://taskel.vercel.app';

export function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, '');
}

export function getSafeRedirectPath(candidate: string | null | undefined, origin: string, fallback = '/') {
  if (!candidate) {
    return fallback;
  }

  try {
    const url = new URL(candidate, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/')) {
      return fallback;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
