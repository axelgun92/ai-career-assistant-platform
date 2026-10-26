// A SYNTHETIC Greenhouse posting modeled on the Healthie Customer Success
// Manager acceptance page (job-boards.greenhouse.io/healthie/jobs/4425790009),
// built only from the statements the human acceptance run reported. It is not
// the real page or API response (no live request is ever made); it gives the
// automated adapter and the browser extension the same evidence, so their
// normalized results can be compared.

export const healthieJobUrl = "https://job-boards.greenhouse.io/healthie/jobs/4425790009";

export const healthieDescriptionParagraphs = [
  "Healthie is the infrastructure behind modern nutrition and wellness practices.",
  "You'll join Healthie's Customer Success team and own a book of provider practices from onboarding through renewal.",
  "This is a full-time, NYC-Hybrid position.",
  "U.S. work authorization is required.",
  "The salary range is $105,000 - $155,000 per year (OTE) annually.",
  "Run onboarding, adoption reviews and renewals for a portfolio of growing practices.",
];

// One job as the Greenhouse Job Board API returns it (content is HTML,
// escaped once more, as the real API sends it).
export function healthieGreenhouseResponse() {
  const html = healthieDescriptionParagraphs.map((line) => `<p>${line}</p>`).join("");
  const escaped = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return {
    jobs: [
      {
        id: 4425790009,
        title: "Customer Success Manager",
        company_name: "Healthie",
        requisition_id: null,
        location: { name: "NYC" },
        absolute_url: healthieJobUrl,
        application_deadline: null,
        content: escaped,
        first_published: "2026-10-14T10:00:00-04:00",
        updated_at: "2026-10-20T10:00:00-04:00",
        departments: [{ id: 1, name: "Customer Success" }],
        offices: [],
        metadata: null,
      },
    ],
    meta: { total: 1 },
  };
}

// The posting page as the browser extension sees it: the job's text in the
// main content, and Greenhouse's application form on the same page.
export function healthiePage() {
  return `<!doctype html><html><head><title>Job Application for Customer Success Manager at Healthie</title></head>
<body>
<header><nav>Healthie careers</nav></header>
<main>
  <h1>Customer Success Manager</h1>
  <div class="job__description">${healthieDescriptionParagraphs.map((line) => `<p>${line}</p>`).join("")}</div>
  <section id="application">
    <h2>Apply for this job</h2>
    <form id="application-form" action="https://boards-api.greenhouse.io/v1/boards/healthie/jobs/4425790009" method="post">
      <label for="first_name">First Name</label><input id="first_name" name="first_name" autocomplete="given-name">
      <label for="last_name">Last Name</label><input id="last_name" name="last_name" autocomplete="family-name">
      <label for="email">Email</label><input id="email" name="email" type="email">
      <div><label for="resume">Resume/CV</label><input id="resume" name="resume" type="file"></div>
      <button type="submit">Submit application</button>
    </form>
  </section>
</main>
<footer>Powered by Greenhouse</footer>
</body></html>`;
}
