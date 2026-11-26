// Job pages for the P1 runtime regression (tests/unit/page-capture-verify-runtime.test.ts):
// one per path of the accepted single-job reader, read both under tsx (by
// tests/support/p1-runtime-harness.ts) and under vitest, so the results can be
// compared. Synthetic pages only; nothing reaches the network.
import { jsonLdPage, linkedInLoggedInPage } from "./extension-pages";

export const p1RuntimeFixtures: Array<{ name: string; url: string; html: string }> = [
  {
    name: "structured data",
    url: "https://jobs.example.com/roles/customer-success-manager",
    html: jsonLdPage({
      title: "Customer Success Manager",
      company: "Northwind",
      descriptionHtml:
        "<p>Own onboarding, adoption and renewals for a portfolio of B2B SaaS customers.</p><ul><li>Run business reviews</li><li>Partner with Sales</li></ul>",
      extra: { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "United States" }, employmentType: "FULL_TIME" },
    }),
  },
  {
    name: "LinkedIn job details",
    url: "https://www.linkedin.com/jobs/view/4100000001",
    html: linkedInLoggedInPage({ id: "4100000001", title: "Senior Customer Success Manager", company: "Contoso", location: "Austin, TX (Remote)" }),
  },
  {
    name: "main content",
    url: "https://careers.example.org/openings/csm",
    html: `<!doctype html><html><head><title>Customer Success Lead - Careers</title></head><body>
<header><nav>Home Careers Contact</nav></header>
<main><h1>Customer Success Lead</h1><p>Remote. Applicants must reside in the United States.</p>
<p>Own onboarding, adoption, education and retention for enterprise customers. Salary $90,000-$110,000.</p>
<section><h2>Similar jobs</h2><p>Support Engineer, Denver</p></section></main>
<footer>© Example</footer></body></html>`,
  },
];
