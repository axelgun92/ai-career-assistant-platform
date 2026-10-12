import {
  evidenceRecordDraftSchema,
  type EvidenceRecordDraft,
} from "@ai-career/evidence";
import { z } from "zod";
import {
  customerSuccessDomainPreferencesSchema,
  loadCustomerSuccessPreferencesFromProfile,
} from "../config/preferences";
import {
  requirementCategorySchema,
  requirementExperienceLevelSchema,
} from "../schemas/maps";

const requiredText = z.string().trim().min(1);

export const experienceRelationshipSchema = z.enum([
  "DIRECT",
  "RELATED",
  "TRANSFERABLE",
]);

const profileStatementSchema = z
  .object({
    id: requiredText,
    statement: requiredText,
  })
  .strict();

const profileExperienceSchema = profileStatementSchema
  .extend({ relationship: experienceRelationshipSchema })
  .strict();

// An affirmative statement that the user lacks something a job may require.
// Its requirement category, and for EXPERIENCE the Customer Success ladder
// level it disclaims, are authored by the user as structure; Resume Match
// never infers a limitation from wording or from missing evidence.
export const profileLimitationSchema = profileStatementSchema
  .extend({
    category: requirementCategorySchema,
    disclaimedExperienceSpecificity: requirementExperienceLevelSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.category === "EXPERIENCE") !==
      (value.disclaimedExperienceSpecificity !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["disclaimedExperienceSpecificity"],
        message:
          "Only an EXPERIENCE limitation states, and must state, the experience level it disclaims",
      });
    }
  });

export type CustomerSuccessProfileLimitation = z.infer<
  typeof profileLimitationSchema
>;

export const profileLimitationEvidenceType = "PROFILE_LIMITATION";

export const customerSuccessUserProfileDataSchema = z
  .object({
    label: requiredText,
    careerGoals: z.array(profileStatementSchema).nullable(),
    experience: z.array(profileExperienceSchema).nullable(),
    skills: z.array(profileStatementSchema).nullable(),
    transferableSkills: z.array(profileStatementSchema).nullable(),
    locationPreferences: z.json().nullable(),
    compensationPreferences: z.json().nullable(),
    workPreferences: z.array(profileStatementSchema).nullable(),
    // Optional so stored profile versions without limitations stay valid.
    limitations: z.array(profileLimitationSchema).nullable().optional(),
    companyPreferences: z.json().nullable(),
    domainPreferences: z.json().nullable(),
  })
  .strict();

export const customerSuccessProfileContextSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    data: customerSuccessUserProfileDataSchema,
    evidence: z.array(evidenceRecordDraftSchema),
  })
  .strict();

export type CustomerSuccessProfileContext = z.infer<
  typeof customerSuccessProfileContextSchema
>;

export function validateCustomerSuccessUserProfileData(input: unknown) {
  const data = customerSuccessUserProfileDataSchema.parse(input);
  customerSuccessDomainPreferencesSchema.parse(data.domainPreferences);
  loadCustomerSuccessPreferencesFromProfile(data.domainPreferences);
  return data;
}

function profileEvidenceReferenceId(category: string, index: number) {
  return `cs-profile-${category}-${index}`;
}

function statementEvidence(
  profileId: string,
  version: number,
  category: string,
  index: number,
  statement: string,
  evidenceType: string,
): EvidenceRecordDraft {
  return evidenceRecordDraftSchema.parse({
    referenceId: profileEvidenceReferenceId(category, index),
    criterionId: "customer-success-profile",
    claim: statement,
    sourceType: "USER_PROFILE",
    sourceRecordId: null,
    provenanceId: null,
    sourceField: category,
    sourceReference: `user-profile:${profileId}:v${version}`,
    sourceText: statement,
    evidenceType,
    origin: "EXPLICIT",
    evidenceLevel: "CONFIRMED",
    collectedAt: null,
  });
}

export function createCustomerSuccessProfileContext(input: {
  id: string;
  version: number;
  data: unknown;
}): CustomerSuccessProfileContext {
  const data = customerSuccessUserProfileDataSchema.parse(input.data);
  const evidence = [
    ...(data.careerGoals ?? []).map((item, index) =>
      statementEvidence(
        input.id,
        input.version,
        "career-goals",
        index,
        item.statement,
        "CAREER_GOAL",
      ),
    ),
    ...(data.experience ?? []).map((item, index) =>
      statementEvidence(
        input.id,
        input.version,
        "experience",
        index,
        item.statement,
        `${item.relationship}_EXPERIENCE`,
      ),
    ),
    ...(data.skills ?? []).map((item, index) =>
      statementEvidence(
        input.id,
        input.version,
        "skills",
        index,
        item.statement,
        "SKILL",
      ),
    ),
    ...(data.transferableSkills ?? []).map((item, index) =>
      statementEvidence(
        input.id,
        input.version,
        "transferable-skills",
        index,
        item.statement,
        "TRANSFERABLE_SKILL",
      ),
    ),
    ...(data.workPreferences ?? []).map((item, index) =>
      statementEvidence(
        input.id,
        input.version,
        "work-preferences",
        index,
        item.statement,
        "WORK_PREFERENCE",
      ),
    ),
    ...(data.limitations ?? []).map((item, index) =>
      statementEvidence(
        input.id,
        input.version,
        "limitations",
        index,
        item.statement,
        profileLimitationEvidenceType,
      ),
    ),
  ];
  return customerSuccessProfileContextSchema.parse({
    id: input.id,
    version: input.version,
    data,
    evidence,
  });
}

// Structured limitation semantics keyed by the profile evidence identity that
// carries each limitation statement.
export function customerSuccessProfileLimitationsByEvidenceReference(
  profile: Pick<CustomerSuccessProfileContext, "data"> | undefined,
) {
  return new Map(
    (profile?.data.limitations ?? []).map((limitation, index) => [
      profileEvidenceReferenceId("limitations", index),
      limitation,
    ]),
  );
}
