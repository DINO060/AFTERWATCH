import { cookies, headers } from 'next/headers';
import { LANG_COOKIE, pickLang, type Lang } from './i18n';

/** Language for the current request: the saved choice, otherwise the browser's Accept-Language. */
export async function requestLang(): Promise<Lang> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return pickLang(cookieStore.get(LANG_COOKIE)?.value, headerStore.get('accept-language'));
}
