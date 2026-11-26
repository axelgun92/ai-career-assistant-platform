import { isLinkedInHost } from "./extension-capture";
import type { SourceCategory } from "./retrieval";

// The one table of job sites the platform recognizes by host, and the
// category each site's listings carry. It is shared by browser-extension
// capture (which site a captured page belongs to, and so its application-link
// precedence) and Source Intelligence (which employer ATS an opportunity's
// links point to). Site keys equal the retrieval adapter keys where an
// adapter exists. Every other host is unrecognized.

export interface KnownSite {
  key: string;
  name: string;
  category: SourceCategory;
  matches: (host: string) => boolean;
}

const exactly = (...hosts: string[]) => (host: string) => hosts.includes(host);
const within = (domain: string) => (host: string) => host === domain || host.endsWith(`.${domain}`);

export const knownSites: readonly KnownSite[] = [
  { key: "greenhouse", name: "Greenhouse", category: "ATS", matches: exactly("boards.greenhouse.io", "job-boards.greenhouse.io") },
  { key: "lever", name: "Lever", category: "ATS", matches: exactly("jobs.lever.co") },
  { key: "ashby", name: "Ashby", category: "ATS", matches: exactly("jobs.ashbyhq.com") },
  { key: "workday", name: "Workday", category: "ATS", matches: within("myworkdayjobs.com") },
  { key: "smartrecruiters", name: "SmartRecruiters", category: "ATS", matches: exactly("jobs.smartrecruiters.com") },
  { key: "workable", name: "Workable", category: "ATS", matches: exactly("apply.workable.com") },
  { key: "workable-jobs", name: "Workable Jobs", category: "JOB_BOARD", matches: exactly("jobs.workable.com") },
  { key: "linkedin", name: "LinkedIn", category: "JOB_BOARD", matches: isLinkedInHost },
  { key: "welcome-to-the-jungle", name: "Welcome to the Jungle", category: "JOB_BOARD", matches: within("welcometothejungle.com") },
  { key: "otta", name: "Otta", category: "JOB_BOARD", matches: within("otta.com") },
  { key: "we-work-remotely", name: "We Work Remotely", category: "JOB_BOARD", matches: within("weworkremotely.com") },
  { key: "remote-ok", name: "Remote OK", category: "JOB_BOARD", matches: (host) => within("remoteok.com")(host) || within("remoteok.io")(host) },
  { key: "himalayas", name: "Himalayas", category: "JOB_BOARD", matches: within("himalayas.app") },
  { key: "working-nomads", name: "Working Nomads", category: "JOB_BOARD", matches: within("workingnomads.com") },
  { key: "wellfound", name: "Wellfound", category: "MARKETPLACE", matches: within("wellfound.com") },
  { key: "adzuna", name: "Adzuna", category: "AGGREGATOR", matches: (host) => /(^|\.)adzuna\.[a-z.]+$/.test(host) },
];

export const normalizedSiteHost = (hostname: string) => hostname.toLowerCase().replace(/^www\./, "");

// The known site a host belongs to, or null.
export function knownSiteForHost(hostname: string): KnownSite | null {
  const host = normalizedSiteHost(hostname);
  return knownSites.find((site) => site.matches(host)) ?? null;
}

// The known site an absolute URL points to, or null (also for an unreadable URL).
export function knownSiteForUrl(value: string | null | undefined): KnownSite | null {
  if (!value) return null;
  try {
    return knownSiteForHost(new URL(value).hostname);
  } catch {
    return null;
  }
}

export function knownSiteByKey(key: string | null | undefined): KnownSite | null {
  return key ? (knownSites.find((site) => site.key === key) ?? null) : null;
}
