import "dotenv/config";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "../../src/server/db";
if (new URL(process.env.DATABASE_URL!).pathname !== "/encova_test")
  throw new Error("E2E fixture creation requires encova_test.");
const provisioning = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
});
for (const [username, role] of [
  ["e2e.admin", "SUPER_ADMIN"],
  ["e2e.member", "MEMBER"],
  ["e2e.reviewer", "MEMBER"],
  ["e2e.outsider", "MEMBER"],
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
console.log("Synthetic browser fixtures ready.");
await db.$disconnect();
