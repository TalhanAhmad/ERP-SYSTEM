import "dotenv/config";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
if (env.AUTH_PROVIDER !== "better-auth")
  throw new Error("Use bootstrap:supabase-admin for Supabase Auth.");
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase(),
  password = process.env.ADMIN_PASSWORD,
  username = process.env.ADMIN_USERNAME?.trim().toLowerCase();
if (
  !email ||
  !password ||
  password.length < 12 ||
  !username ||
  !/^[-a-z0-9._]{3,30}$/.test(username)
)
  throw new Error(
    "Set ADMIN_EMAIL, ADMIN_PASSWORD (12+ chars), ADMIN_USERNAME (3–30 valid chars). Passwords are never printed.",
  );
await db.$transaction(
  async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(987661)::text`;
    if (
      await tx.person.count({
        where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      })
    )
      throw new Error(
        "An active super admin already exists. Use invitation administration.",
      );
    const provisioning = betterAuth({
      database: prismaAdapter(tx as unknown as typeof db, {
        provider: "postgresql",
      }),
      secret: process.env.BETTER_AUTH_SECRET,
      emailAndPassword: { enabled: true, minPasswordLength: 12 },
      advanced: { database: { generateId: () => crypto.randomUUID() } },
    });
    const result = await provisioning.api.signUpEmail({
      body: { name: process.env.ADMIN_NAME ?? username, email, password },
    });
    await tx.user.update({
      where: { id: result.user.id },
      data: { emailVerified: true },
    });
    const person = await tx.person.create({
      data: {
        authUserId: result.user.id,
        email,
        username,
        displayName: process.env.ADMIN_NAME ?? username,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
      },
    });
    await tx.audit.create({
      data: {
        actorId: person.id,
        action: "SUPER_ADMIN_BOOTSTRAPPED",
        entityId: person.id,
        changes: {},
        requestId: crypto.randomUUID(),
      },
    });
  },
  { timeout: 30000 },
);
console.log(
  "Super admin created. The operator is responsible for independently verifying email ownership before production use.",
);
await db.$disconnect();
