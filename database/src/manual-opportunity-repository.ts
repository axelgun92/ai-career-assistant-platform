import type {
  ManualOpportunityDetail,
  ManualOpportunityRepository,
  NormalizedOpportunity,
  RawOpportunity,
} from "@ai-career/core";
import type { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

type OpportunityDetailRecord = Prisma.OpportunityGetPayload<{
  include: {
    company: true;
    sourceRecords: true;
    fieldProvenance: true;
  };
}>;

function mapOpportunityDetail(
  record: OpportunityDetailRecord,
): ManualOpportunityDetail {
  return {
    opportunity: {
      id: record.id,
      domain: record.domain,
      externalListingId: record.externalListingId,
      atsRequisitionId: record.atsRequisitionId,
      canonicalUrl: record.canonicalUrl,
      applicationUrl: record.applicationUrl,
      originalSource: record.originalSource,
      discoveredAt: record.discoveredAt,
      sourceUpdatedAt: record.sourceUpdatedAt,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      companyName: record.company?.name ?? null,
      brand: record.company?.brand ?? null,
      parentCompany: null,
      industry: record.company?.industry ?? null,
      headquarters: record.company?.headquarters ?? null,
      companySize: record.company?.companySize ?? null,
      title: record.title,
      department: record.department,
      employmentType: record.employmentType,
      seniority: record.seniority,
      location: record.location,
      remoteStatus: record.remoteStatus,
      timeZoneRequirements: record.timeZoneRequirements,
      salaryMin: record.salaryMin?.toNumber() ?? null,
      salaryMax: record.salaryMax?.toNumber() ?? null,
      salaryText: record.salaryText,
      bonus: record.bonus,
      equity: record.equity,
      currency: record.currency,
      compensationNotes: record.compensationNotes,
      postingDate: record.postingDate,
      closingDate: record.closingDate,
      source: record.source,
      sourceType: record.sourceType,
      atsPlatform: record.atsPlatform,
      jobDescription: record.jobDescription,
      responsibilities: record.responsibilities,
      requirements: record.requirements,
      benefits: record.benefits,
      additionalNotes: record.additionalNotes,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    sourceRecords: record.sourceRecords.map((sourceRecord) => ({
      id: sourceRecord.id,
      source: sourceRecord.source,
      sourceType: sourceRecord.sourceType,
      sourceUrl: sourceRecord.sourceUrl,
      externalId: sourceRecord.externalId,
      requisitionId: sourceRecord.requisitionId,
      rawTitle: sourceRecord.rawTitle,
      rawCompany: sourceRecord.rawCompany,
      rawLocation: sourceRecord.rawLocation,
      rawDescription: sourceRecord.rawDescription,
      rawSalaryText: sourceRecord.rawSalaryText,
      rawEmploymentType: sourceRecord.rawEmploymentType,
      rawPostingDate: sourceRecord.rawPostingDate,
      sourceMetadata: sourceRecord.sourceMetadata,
      rawPayload: sourceRecord.rawPayload,
      discoveredAt: sourceRecord.discoveredAt,
      lastObservedAt: sourceRecord.lastObservedAt,
      normalizedAt: sourceRecord.normalizedAt,
      createdAt: sourceRecord.createdAt,
      updatedAt: sourceRecord.updatedAt,
    })),
    fieldProvenance: record.fieldProvenance.map((provenance) => ({
      id: provenance.id,
      sourceRecordId: provenance.sourceRecordId,
      fieldName: provenance.fieldName,
      sourceField: provenance.sourceField,
      kind: provenance.kind,
      normalizedValue: provenance.normalizedValue,
      sourceReference: provenance.sourceReference,
      sourceText: provenance.sourceText,
      collectedAt: provenance.collectedAt,
      createdAt: provenance.createdAt,
    })),
  };
}

export class PrismaManualOpportunityRepository
  implements ManualOpportunityRepository
{
  private readonly database = getDatabaseClient();

  async createManualSourceRecord(rawOpportunity: RawOpportunity) {
    const sourceRecord = await this.database.sourceRecord.create({
      data: {
        source: rawOpportunity.source,
        sourceType: rawOpportunity.sourceType,
        sourceUrl: rawOpportunity.sourceUrl,
        externalId: rawOpportunity.externalId,
        requisitionId: rawOpportunity.requisitionId,
        rawTitle: rawOpportunity.title,
        rawCompany: rawOpportunity.company,
        rawLocation: rawOpportunity.location,
        rawDescription: rawOpportunity.description,
        rawSalaryText: rawOpportunity.salaryText,
        rawEmploymentType: rawOpportunity.employmentType,
        rawPostingDate: rawOpportunity.postingDate,
        sourceMetadata:
          rawOpportunity.sourceMetadata === null
            ? undefined
            : asInputJson(rawOpportunity.sourceMetadata),
        rawPayload:
          rawOpportunity.rawPayload === null
            ? undefined
            : asInputJson(rawOpportunity.rawPayload),
        discoveredAt: rawOpportunity.discoveredAt,
        lastObservedAt: rawOpportunity.discoveredAt,
      },
      select: { id: true, discoveredAt: true },
    });

    return sourceRecord;
  }

  async createDiscoveredOpportunity(input: {
    sourceRecordId: string;
    opportunity: NormalizedOpportunity;
    provenance: Parameters<
      ManualOpportunityRepository["createDiscoveredOpportunity"]
    >[0]["provenance"];
  }) {
    return this.database.$transaction(async (transaction) => {
      const sourceRecord = await transaction.sourceRecord.findUnique({
        where: { id: input.sourceRecordId },
        select: { id: true, opportunityId: true },
      });

      if (!sourceRecord) {
        throw new Error("SourceRecord does not exist");
      }

      if (sourceRecord.opportunityId !== null) {
        throw new Error("SourceRecord is already linked to an Opportunity");
      }

      const company = input.opportunity.companyName
        ? await transaction.company.create({
            data: { name: input.opportunity.companyName },
            select: { id: true },
          })
        : null;

      const opportunity = await transaction.opportunity.create({
        data: {
          domain: input.opportunity.domain,
          externalListingId: input.opportunity.externalListingId,
          atsRequisitionId: input.opportunity.atsRequisitionId,
          canonicalUrl: input.opportunity.canonicalUrl,
          applicationUrl: input.opportunity.applicationUrl,
          originalSource: input.opportunity.originalSource,
          discoveredAt: input.opportunity.discoveredAt,
          sourceUpdatedAt: input.opportunity.sourceUpdatedAt,
          firstSeenAt: input.opportunity.firstSeenAt,
          lastSeenAt: input.opportunity.lastSeenAt,
          companyId: company?.id,
          title: input.opportunity.title,
          department: input.opportunity.department,
          employmentType: input.opportunity.employmentType,
          seniority: input.opportunity.seniority,
          location: input.opportunity.location,
          remoteStatus: input.opportunity.remoteStatus,
          timeZoneRequirements: input.opportunity.timeZoneRequirements,
          salaryMin: input.opportunity.salaryMin,
          salaryMax: input.opportunity.salaryMax,
          salaryText: input.opportunity.salaryText,
          bonus: input.opportunity.bonus,
          equity: input.opportunity.equity,
          currency: input.opportunity.currency,
          compensationNotes: input.opportunity.compensationNotes,
          postingDate: input.opportunity.postingDate,
          closingDate: input.opportunity.closingDate,
          source: input.opportunity.source,
          sourceType: input.opportunity.sourceType,
          atsPlatform: input.opportunity.atsPlatform,
          jobDescription: input.opportunity.jobDescription,
          responsibilities: input.opportunity.responsibilities,
          requirements: input.opportunity.requirements,
          benefits: input.opportunity.benefits,
          additionalNotes: input.opportunity.additionalNotes,
          status: "DISCOVERED",
        },
        select: { id: true },
      });

      if (input.provenance.length > 0) {
        await transaction.fieldProvenance.createMany({
          data: input.provenance.map((provenance) => ({
            opportunityId: opportunity.id,
            sourceRecordId: input.sourceRecordId,
            fieldName: provenance.fieldName,
            sourceField: provenance.sourceField,
            kind: provenance.kind,
            normalizedValue: asInputJson(provenance.normalizedValue),
            sourceReference: provenance.sourceReference,
            sourceText: provenance.sourceText,
            collectedAt: provenance.collectedAt,
          })),
        });
      }

      await transaction.sourceRecord.update({
        where: { id: input.sourceRecordId },
        data: {
          opportunityId: opportunity.id,
          normalizedAt: new Date(),
        },
      });

      return opportunity;
    });
  }

  async transitionOpportunityStatus(input: {
    opportunityId: string;
    from: Parameters<
      ManualOpportunityRepository["transitionOpportunityStatus"]
    >[0]["from"];
    to: Parameters<
      ManualOpportunityRepository["transitionOpportunityStatus"]
    >[0]["to"];
  }) {
    const result = await this.database.opportunity.updateMany({
      where: { id: input.opportunityId, status: input.from },
      data: { status: input.to },
    });

    if (result.count !== 1) {
      throw new Error(
        `Opportunity lifecycle transition ${input.from} -> ${input.to} was rejected`,
      );
    }
  }

  private findRecord(id: string) {
    return this.database.opportunity.findUnique({
      where: { id },
      include: {
        company: true,
        sourceRecords: { orderBy: { createdAt: "asc" } },
        fieldProvenance: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  async findOpportunityDetail(id: string) {
    const record = await this.findRecord(id);
    return record ? mapOpportunityDetail(record) : null;
  }
}
