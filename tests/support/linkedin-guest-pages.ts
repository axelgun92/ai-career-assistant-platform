// LinkedIn's public, logged-out job page (/jobs/view/<id>), as Mode B's
// automatic detail acquisition reads it in a fresh browser: the top card
// (title, company, location, posted time), the description and the job
// criteria list, with no JSON-LD, so the single-job reader's LinkedIn
// job-detail path is the one exercised. Synthetic pages modelled on the
// public layout the reader targets; none is a captured response.

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function linkedInGuestJobPage(input: {
  id: string;
  title: string;
  company: string;
  location: string;
  descriptionHtml: string;
  posted?: string;
  seniority?: string;
  employmentType?: string;
}): string {
  return `<!doctype html><html><head><title>${escape(input.company)} hiring ${escape(input.title)} in ${escape(input.location)} | LinkedIn</title>
<link rel="canonical" href="https://www.linkedin.com/jobs/view/${input.id}"></head><body>
<header class="public_profile_nav"><a href="https://www.linkedin.com/login">Sign in</a><a href="https://www.linkedin.com/signup">Join now</a></header>
<main class="main" id="main-content">
<section class="top-card-layout">
  <h1 class="top-card-layout__title">${escape(input.title)}</h1>
  <h4 class="top-card-layout__second-subline">
    <span class="topcard__flavor"><a class="topcard__org-name-link" href="https://www.linkedin.com/company/example">${escape(input.company)}</a></span>
    <span class="topcard__flavor topcard__flavor--bullet">${escape(input.location)}</span>
    <span class="posted-time-ago__text">${escape(input.posted ?? "1 day ago")}</span>
  </h4>
</section>
<section class="description">
  <div class="description__text description__text--rich"><section class="show-more-less-html"><div class="show-more-less-html__markup">${input.descriptionHtml}</div></section></div>
  <ul class="description__job-criteria-list">
    <li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Seniority level</h3><span class="description__job-criteria-text">${escape(input.seniority ?? "Mid-Senior level")}</span></li>
    <li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Employment type</h3><span class="description__job-criteria-text">${escape(input.employmentType ?? "Full-time")}</span></li>
  </ul>
</section>
<section class="similar-jobs"><h2>Similar jobs</h2><ul><li><a href="https://www.linkedin.com/jobs/view/9999999999">Support Engineer</a></li></ul></section>
</main></body></html>`;
}

// The real LinkedIn F0 cards (tests/fixtures/page-capture/linkedin-f0-cards.json)
// placed back into a results list, for the Mode B results reader.
export function linkedInF0ResultsPage(cards: readonly string[]): string {
  return `<!doctype html><html><head><title>Customer Success jobs | LinkedIn</title></head><body>
<header class="public_profile_nav"><a href="https://www.linkedin.com/login">Sign in</a></header>
<main><section class="two-pane-serp-page__results-list"><ul class="jobs-search__results-list">${cards.join("\n")}</ul></section></main></body></html>`;
}
