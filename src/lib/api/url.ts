const DEFAULT_APP_URL = 'https://taskel.vercel.app';

export function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, '');
}
