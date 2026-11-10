import "dotenv/config";
import { validateCustomerSuccessUserProfileData } from "@ai-career/customer-success";
import {
  getDatabaseClient,
  PrismaUserProfileRepository,
  type VersionedUserProfileData,
} from "@ai-career/database";
import { alexandraNugentCustomerSuccessProfile } from "./alexandra-nugent-customer-success-profile";

const database = getDatabaseClient();
// Without --activate an imported version is saved but not used for new
// evaluations; whatever was in use stays in use until the user activates a
// version explicitly (here, or on the Profile page).
const activate = process.argv.includes("--activate");

async function main() {
  try {
    const profile = validateCustomerSuccessUserProfileData(
      alexandraNugentCustomerSuccessProfile,
    );
    const result = await new PrismaUserProfileRepository().saveVersion(
      "customer-success",
      profile as VersionedUserProfileData,
      { activate },
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
    process.stdout.write(
      result.activated
        ? `Version ${result.version} is now active for new Customer Success evaluations.\n`
        : "The active profile version is unchanged. Pass --activate (or use the Profile page) to make this version active.\n",
    );
  } finally {
    await database.$disconnect();
  }
}

void main();
