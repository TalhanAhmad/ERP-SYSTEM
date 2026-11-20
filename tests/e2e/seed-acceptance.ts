import "dotenv/config";
import { readFile, stat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { seedAccountingAcceptance } from "../fixtures/finance-acceptance";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { verifyFinanceReauthentication } from "@/modules/finance/access/reauth";
import {
  reserveStatement,
  uploadStatementChunk,
  previewStatement,
  importStatement,
} from "@/modules/finance/treasury/statements/service";
import {
  bankMatchPreview,
  bankMatchCommand,
} from "@/modules/finance/treasury/matching/service";
import { reconciliationCommand } from "@/modules/finance/treasury/reconciliation/service";
import { assetCommand } from "@/modules/finance/assets/service";
import { accessCommand } from "@/modules/finance/access/service";
async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  if (
    target.pathname !== "/encova_test" ||
    !["localhost", "127.0.0.1"].includes(target.hostname)
  )
    throw Error("F45 requires a loopback encova_test database.");
  const file = await realpath(process.argv[2] ?? ""),
    root = await realpath(".local/finance"),
    info = await stat(file);
  if (
    !file.startsWith(root + path.sep) ||
    !info.isFile() ||
    (info.mode & 0o077) !== 0
  )
    throw Error("Private owned fixture credential file required.");
  try {
    const credentials = JSON.parse(await readFile(file, "utf8")) as {
      cookie: string;
      password: string;
    };
    const verify = () =>
      verifyFinanceReauthentication(
        new Request(env.APP_URL + "/api/v1/finance/status", {
          headers: { cookie: credentials.cookie, origin: env.APP_URL },
        }),
        { password: credentials.password },
      );
    const call = async <T>(
      fn: (v: Awaited<ReturnType<typeof verify>>) => Promise<T>,
    ) => fn(await verify());
    const fixture = await seedAccountingAcceptance(verify),
      owner = (await verify()).actor;
    await call((v) =>
      assetCommand(
        v.actor,
        v.proof,
        "UPDATE",
        {
          id: fixture.asset.id,
          expectedVersion: fixture.asset.version,
          tag: "F43-EQUIPMENT",
          description: "Acceptance equipment",
          location: "Synthetic office",
          custodianId: null,
          inServiceDate: "2020-01-08",
          usefulLifeMonths: 60,
          residualValue: "0.00",
          depreciationMethod: "STRAIGHT_LINE",
          convention: "FULL_MONTH_FROM_FIRST_MONTH",
          firstDepMonth: "2020-02",
          policyEvidence:
            "Explicit synthetic first charge February2020; no January depreciation",
          reason: "Review the actual test asset convention before closing",
        },
        crypto.randomUUID(),
      ),
    );
    const bankLines = await db.$queryRaw<
      { id: string; date: string; amount: string; reference: string }[]
    >`SELECT l.id,e."postingDate"::text AS date,(l.debit-l.credit)::text AS amount,e.reference FROM "FinanceJournalLine" l JOIN "FinanceJournalEntry" e ON e.id=l."journalId" WHERE l."accountId"=${fixture.accounts.bank}::uuid ORDER BY e."postingDate",l.id`;
    if (bankLines.length !== 7)
      throw Error("Expected seven exact acceptance bank legs.");
    const bytes = Buffer.from(
        "Date,Amount,Description,Reference\n" +
          bankLines
            .map(
              (l, i) =>
                `${l.date},${l.amount},Acceptance bank source ${i + 1},${l.reference}`,
            )
            .join("\n") +
          "\n",
      ),
      sha = createHash("sha256").update(bytes).digest("hex");
    const upload = await call((v) =>
      reserveStatement(
        v.actor,
        v.proof,
        {
          cashAccountId: fixture.bank,
          fileName: "acceptance-bank.csv",
          byteSize: bytes.length,
          sha256: sha,
          reason: "Import exact synthetic bank evidence",
        },
        crypto.randomUUID(),
      ),
    );
    if (!upload.upload || !upload.intent)
      throw Error("Fresh synthetic statement upload required.");
    await uploadStatementChunk(owner, upload.upload.id, {
      index: 0,
      content: bytes.toString("base64"),
      sha256: sha,
      intent: upload.intent,
    });
    const metadata = {
      mapping: {
        mode: "SIGNED",
        skipRows: 0,
        dateColumn: 0,
        dateFormat: "ISO",
        amountColumn: 1,
        positiveMeans: "RECEIPT",
        descriptionColumn: 2,
        referenceColumn: 3,
      },
      startDate: "2020-01-01",
      endDate: "2020-01-31",
      openingBalance: "0.00",
      closingBalance: "575000.00",
      currency: "PKR",
    };
    const preview = await previewStatement(owner, upload.upload.id, metadata),
      batch = await call((v) =>
        importStatement(
          v.actor,
          v.proof,
          upload.upload!.id,
          {
            ...metadata,
            expectedVersion: preview.uploadVersion,
            basisHash: preview.basisHash,
            acknowledgedRows: [],
            duplicateReview: "",
            reason: "Review all original synthetic statement rows",
          },
          crypto.randomUUID(),
        ),
      );
    const rows = await db.financeStatementLine.findMany({
      where: { batchId: batch.id },
      orderBy: { sequence: "asc" },
    });
    if (rows.length !== bankLines.length)
      throw Error("Statement source count mismatch.");
    for (let n = 0; n < rows.length; n++) {
      const allocations = [
          {
            statementLineId: rows[n].id,
            journalLineId: bankLines[n].id,
            amount: rows[n].amount.toFixed(2),
          },
        ],
        proposal = await bankMatchPreview(owner, {
          cashAccountId: fixture.bank,
          allocations,
        });
      await call((v) =>
        bankMatchCommand(
          v.actor,
          v.proof,
          "MATCH",
          {
            cashAccountId: fixture.bank,
            allocations,
            basisHash: proposal.basisHash,
            description: "Exact original bank source " + (n + 1),
            evidence:
              "Actual synthetic statement and immutable cash source agree",
            reason: "Match original bank evidence without new cash",
          },
          crypto.randomUUID(),
        ),
      );
    }
    const reconciliation = await call((v) =>
      reconciliationCommand(
        v.actor,
        v.proof,
        "CREATE",
        {
          mode: "STATEMENT",
          cashAccountId: fixture.bank,
          statementBatchId: batch.id,
          evidence:
            "All seven actual synthetic bank legs match; bank575000.00 equals GL",
          reason: "Prepare independent owner reconciliation review",
        },
        crypto.randomUUID(),
      ),
    );
    const petty = await call((v) =>
      reconciliationCommand(
        v.actor,
        v.proof,
        "CREATE",
        {
          mode: "ZERO_ACTIVITY",
          cashAccountId: fixture.petty,
          startDate: "2020-01-01",
          cutoffDate: "2020-01-31",
          openingBalance: "0.00",
          closingBalance: "0.00",
          evidence: "No petty-cash activity exists in this exact test scenario",
          reason: "Review actual zero-activity synthetic cash",
        },
        crypto.randomUUID(),
      ),
    );
    await call((v) =>
      reconciliationCommand(
        v.actor,
        v.proof,
        "FINALIZE",
        {
          id: petty.id,
          expectedVersion: petty.version,
          reason: "Finalize exact zero-activity proof",
        },
        crypto.randomUUID(),
      ),
    );
    const selected = await db.person.findUniqueOrThrow({
        where: { username: "e2e.finance.target" },
      }),
      settings = await db.financeSettings.findFirstOrThrow();
    await call((v) =>
      accessCommand(
        v.actor,
        v.proof,
        "GRANT",
        {
          targetId: selected.id,
          expectedVersion: settings.version,
          reason:
            "Explicit eligible synthetic reviewer for end-to-end revocation",
        },
        crypto.randomUUID(),
      ),
    );
    if ((await db.financeJournalEntry.count()) !== 9)
      throw Error("Review preparation must not create another journal.");
    console.log(
      JSON.stringify({
        fixture,
        reconciliationId: reconciliation.id,
        selectedId: selected.id,
        selectedEmail: selected.email,
      }),
    );
  } finally {
    await rm(file, { force: true });
  }
}
try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "F45 owned preparation failed.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
