// Local record of this device's successful deploys, for the landing page's
// "Your sites" chip list. Deliberately localStorage-only (same trust model
// as drafts): the chain knows ownership, but querying DotNS for "all names
// owned by this account" is an enumeration the contracts don't offer — and
// a local list is exactly the "sites I made here" the landing page wants.

export interface DeployedSite {
  /** Bare label, no `.dot` suffix. */
  domain: string;
  /** Gateway URL as returned by the deploy. */
  url: string;
  deployedAt: number;
}

const KEY = "site-builder.deployed.v1";

export function loadDeployedSites(): DeployedSite[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is DeployedSite =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as DeployedSite).domain === "string" &&
        typeof (s as DeployedSite).url === "string",
    );
  } catch {
    return [];
  }
}

/** Newest first; a re-deploy of the same domain moves it to the front. */
export function recordDeployedSite(domain: string, url: string): void {
  try {
    const rest = loadDeployedSites().filter((s) => s.domain !== domain);
    localStorage.setItem(
      KEY,
      JSON.stringify([{ domain, url, deployedAt: Date.now() }, ...rest]),
    );
  } catch {
    // Quota / private browsing — the list is a convenience, not state.
  }
}
