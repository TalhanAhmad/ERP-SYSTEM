import "dotenv/config";
import { processFinanceExports } from "../../src/modules/finance/reports/exports/worker";
import { db } from "../../src/server/db";
try {
  await processFinanceExports();
  console.log("Private finance export worker pass completed.");
} finally {
  await db.$disconnect();
}
