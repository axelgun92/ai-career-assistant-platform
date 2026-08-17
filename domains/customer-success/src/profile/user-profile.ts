import {
  evidenceRecordDraftSchema,
  type EvidenceRecordDraft,
} from "@ai-career/evidence";
import { z } from "zod";

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

function statementEvidence(
  profileId: string,
  version: number,
  category: string,
  index: number,
  statement: string,
  evidenceType: string,
): EvidenceRecordDraft {
  return evidenceRecordDraftSchema.parse({
    referenceId: `cs-profile-${category}-${index}`,
    criterionId: "alex-fit",
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
  ];
  return customerSuccessProfileContextSchema.parse({
    id: input.id,
    version: input.version,
    data,
    evidence,
  });
}
