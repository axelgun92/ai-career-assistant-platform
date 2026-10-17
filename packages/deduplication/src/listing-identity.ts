// Exact listing identifiers: URL keys and source/requisition IDs.

// Query parameters that only track how a link was shared. Parameters that
// identify the listing (for example Greenhouse's gh_jid) are kept.
const trackingParameter = /^(utm_.+|gclid|fbclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi)$/i;

// A comparable key for a listing URL, or null when the value is not an
// http(s) URL or points only at a site root (a home page identifies no
// listing). Host case, "www.", default ports, trailing slashes, path case,
// tracking parameters and parameter order are ignored; a fragment is kept
// only when it carries a route ("#/jobs/123").
export function listingUrlKey(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  const parameters = [...url.searchParams.entries()]
    .filter(([name]) => !trackingParameter.test(name))
    .sort(([left, leftValue], [right, rightValue]) =>
      left === right ? leftValue.localeCompare(rightValue) : left.localeCompare(right),
    );
  const query = new URLSearchParams(parameters).toString();
  const route = url.hash.includes("/") ? url.hash.toLowerCase() : "";
  if (!path && !query && !route) return null;
  return `${host}${path}${query ? `?${query}` : ""}${route}`;
}

// The host plus path of a listing URL, used only to prefilter candidates
// (every URL with the same key contains it).
export function listingUrlPrefix(value: string | null | undefined): string | null {
  const key = listingUrlKey(value);
  if (!key) return null;
  return key.split(/[?#]/)[0]!;
}

export function listingIdKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}
