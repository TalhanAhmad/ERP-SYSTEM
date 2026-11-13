import "dotenv/config";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "../../src/server/db";
if (new URL(process.env.DATABASE_URL!).pathname !== "/encova_test")
  throw new Error("E2E fixture creation requires encova_test.");
// Integration tests own a fixed synthetic holiday. It must not turn the wall-clock
// browser punch day into a holiday when the calendar reaches that fixture date.
const browserWorkDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Karachi",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
await db.holiday.deleteMany({
  where: { date: new Date(browserWorkDate), name: "Synthetic holiday" },
});
const provisioning = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
});
for (const [username, role] of [
  ["e2e.admin", "SUPER_ADMIN"],
  ["e2e.hr", "HR_ADMIN"],
  ["e2e.member", "MEMBER"],
  ["e2e.reviewer", "MEMBER"],
  ["e2e.outsider", "MEMBER"],
  ["e2e.finance", "SUPER_ADMIN"],
  ["e2e.finance.owner", "SUPER_ADMIN"],
  ["e2e.finance.target", "SUPER_ADMIN"],
  ["e2e.finance.third", "SUPER_ADMIN"],
  ["e2e.finance.setup", "SUPER_ADMIN"],
  ["e2e.finance.ledger", "SUPER_ADMIN"],
  ["e2e.finance.writer", "SUPER_ADMIN"],
  ["e2e.finance.masters", "SUPER_ADMIN"],
  ["e2e.finance.suppliers", "SUPER_ADMIN"],
  ["e2e.finance.supplier.writer", "SUPER_ADMIN"],
  ["e2e.finance.bills", "SUPER_ADMIN"],
  ["e2e.finance.invoices", "SUPER_ADMIN"],
  ["e2e.finance.invoice.ui", "SUPER_ADMIN"],
  ["e2e.finance.receipt.ui", "SUPER_ADMIN"],
  ["e2e.finance.advance.ui", "SUPER_ADMIN"],
  ["e2e.finance.credit.ui", "SUPER_ADMIN"],
  ["e2e.finance.credit.writer", "SUPER_ADMIN"],
  ["e2e.finance.release.ui", "SUPER_ADMIN"],
  ["e2e.finance.release.writer", "SUPER_ADMIN"],
  ["e2e.finance.advance.writer", "SUPER_ADMIN"],
  ["e2e.finance.receipt.writer", "SUPER_ADMIN"],
  ["e2e.finance.invoice.writer", "SUPER_ADMIN"],
] as const) {
  const email = `${username}@example.test`;
  if (await db.person.findUnique({ where: { email } })) continue;
  const identity = await provisioning.api.signUpEmail({
    body: { name: username, email, password: "Synthetic-browser-test-only-9#" },
  });
  await db.user.update({
    where: { id: identity.user.id },
    data: { emailVerified: true },
  });
  await db.person.create({
    data: {
      authUserId: identity.user.id,
      email,
      username,
      displayName: username,
      role,
      status: "ACTIVE",
    },
  });
}
for (const username of [
  "e2e.finance",
  "e2e.finance.writer",
  "e2e.finance.supplier.writer",
  "e2e.finance.invoice.writer",
  "e2e.finance.receipt.writer",
  "e2e.finance.advance.writer",
  "e2e.finance.credit.writer",
  "e2e.finance.release.writer",
]) {
  const financePerson = await db.person.findUniqueOrThrow({
    where: { username },
  });
  if (
    !(await db.financeGrant.findFirst({
      where: { userId: financePerson.id, revokedAt: null },
    }))
  ) {
    await db.financeGrant.create({
      data: {
        userId: financePerson.id,
        grantedById: financePerson.id,
        reason: "Explicit isolated browser finance fixture",
      },
    });
  }
}
console.log("Synthetic browser fixtures ready.");
await db.$disconnect();
