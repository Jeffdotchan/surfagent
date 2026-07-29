import { listTargets, CDPTarget } from './connector.js';

export interface TabInfo {
  id: string;
  index: number;
  title: string;
  url: string;
}

export async function getAllTabs(port?: number, host?: string): Promise<TabInfo[]> {
  const targets = await listTargets(port, host);
  return targets.map((target: CDPTarget, index: number) => ({
    id: target.id,
    index,
    title: target.title,
    url: target.url
  }));
}

export async function findTab(pattern: string, port?: number, host?: string): Promise<TabInfo | null> {
  const tabs = await getAllTabs(port, host);

  // Exact CDP tab id first. Ids are 32-char hex, so one beginning with digits
  // (e.g. "0123ABCD…") parses as an index and, with enough tabs open, would
  // silently select an unrelated tab. /capture is given an id from a prior
  // /recon, and tab counts climb during a run, so id must win over index.
  const byId = tabs.find(tab => tab.id === pattern);
  if (byId) return byId;

  // Then a numeric index
  const index = parseInt(pattern, 10);
  if (!isNaN(index) && index >= 0 && index < tabs.length) {
    return tabs[index];
  }

  // Check if pattern matches URL or title (case-insensitive)
  const lowerPattern = pattern.toLowerCase();
  return tabs.find(tab =>
    tab.url.toLowerCase().includes(lowerPattern) ||
    tab.title.toLowerCase().includes(lowerPattern)
  ) || null;
}
