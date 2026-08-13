import { createManualOpportunityService } from "@ai-career/core";
import { PrismaManualOpportunityRepository } from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";

type Service = ReturnType<typeof createManualOpportunityService>;

let manualOpportunityService: Service | undefined;

export function getManualOpportunityService(): Service {
  manualOpportunityService ??= createManualOpportunityService({
    repository: new PrismaManualOpportunityRepository(),
    normalizer: createManualOpportunityNormalizer(),
  });

  return manualOpportunityService;
}
