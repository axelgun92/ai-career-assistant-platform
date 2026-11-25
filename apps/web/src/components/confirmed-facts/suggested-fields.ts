import type { ConfirmedFactField } from "@ai-career/core";

// The confirmable fields a triage review reason asks about (November 25,
// 2026). A plain module, not the client panel's: the opportunity page (a
// server component) calls it to order the panel's fields.
const reasonFields: Array<[RegExp, ConfirmedFactField]> = [
  [/^salary-(unknown-salary|open-maximum-unknown|conflicting-salary)$/, "salaryRange"],
  [/^salary-unknown-currency$/, "currency"],
  [/^salary-ote-not-confirmed-base$/, "compensationBasis"],
  [/^salary-tiers-differ$/, "applicableTier"],
  [/^(residency-|salary-unknown-residency|salary-conflicting-residency|salary-non-us-conditional-unknown)/, "residency"],
  [/^work-arrangement-(unknown|conflicting)$/, "workArrangements"],
  [/^employment-type-/, "employmentType"],
  [/^work-(authorization|eligibility)-/, "workAuthorization"],
  [/^seniority-.*-ambiguous$/, "seniority"],
];

export function suggestedConfirmableFields(reasonCodes: readonly string[]): ConfirmedFactField[] {
  const fields: ConfirmedFactField[] = [];
  for (const code of reasonCodes) {
    for (const [pattern, field] of reasonFields) if (pattern.test(code) && !fields.includes(field)) fields.push(field);
  }
  return fields;
}
