import "dotenv/config";
import { validateCustomerSuccessUserProfileData } from "@ai-career/customer-success";
import {
  getDatabaseClient,
  PrismaUserProfileImportRepository,
  type VersionedUserProfileData,
} from "@ai-career/database";
import { alexandraNugentCustomerSuccessProfile } from "./alexandra-nugent-customer-success-profile";

const database = getDatabaseClient();

async function main() {
  try {
    const profile = validateCustomerSuccessUserProfileData(
      alexandraNugentCustomerSuccessProfile,
    );
    const result = await new PrismaUserProfileImportRepository().import(
      profile as VersionedUserProfileData,
    );

    if (result.status === "CREATED") {
      process.stdout.write(
        `Customer Success profile import succeeded: created version ${result.version} (${result.id}).\n`,
      );
    } else {
      process.stdout.write(
        `Customer Success profile already imported: version ${result.version} (${result.id}); no duplicate was created.\n`,
      );
    }
  } finally {
    await database.$disconnect();
  }
}

void main();
