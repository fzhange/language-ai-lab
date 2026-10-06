export const SITE_BLOCKLIST_KEY = 'whw-site-blocklist:';

export async function getDisabledSites(): Promise<string[]> {
  const data = await chrome.storage.local.get(null);
  return Object.keys(data)
    .filter((key) => key.startsWith(SITE_BLOCKLIST_KEY) && data[key] === true)
    .map((key) => key.slice(SITE_BLOCKLIST_KEY.length))
    .sort();
}

export async function disableSite(hostname: string): Promise<void> {
  if (!hostname) return;
  await chrome.storage.local.set({ [SITE_BLOCKLIST_KEY + hostname]: true });
}

export async function enableSite(hostname: string): Promise<void> {
  await chrome.storage.local.remove(SITE_BLOCKLIST_KEY + hostname);
}

export function isSiteDisabled(url: string, sites: string[]): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && sites.includes(parsed.hostname);
  } catch {
    return false;
  }
}
