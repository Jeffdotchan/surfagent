import { listTargets } from './connector.js';
export async function getAllTabs(port, host) {
    const targets = await listTargets(port, host);
    return targets.map((target, index) => ({
        id: target.id,
        index,
        title: target.title,
        url: target.url
    }));
}
export async function findTab(pattern, port, host) {
    const tabs = await getAllTabs(port, host);
    // Exact CDP tab id first. Ids are 32-char hex, so one beginning with digits
    // (e.g. "0123ABCD…") parses as an index and, with enough tabs open, would
    // silently select an unrelated tab. /capture is given an id from a prior
    // /recon, and tab counts climb during a run, so id must win over index.
    const byId = tabs.find(tab => tab.id === pattern);
    if (byId)
        return byId;
    // Then a numeric index
    const index = parseInt(pattern, 10);
    if (!isNaN(index) && index >= 0 && index < tabs.length) {
        return tabs[index];
    }
    // Check if pattern matches URL or title (case-insensitive)
    const lowerPattern = pattern.toLowerCase();
    return tabs.find(tab => tab.url.toLowerCase().includes(lowerPattern) ||
        tab.title.toLowerCase().includes(lowerPattern)) || null;
}
