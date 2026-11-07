import "dotenv/config";
import { supabaseAdmin } from "../src/server/supabase/client";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { z } from "zod";
if (env.AUTH_PROVIDER !== "supabase")
  throw new Error("Set AUTH_PROVIDER=supabase before running this command.");
const input = z
  .object({
    ADMIN_EMAIL: z.email().transform((v) => v.trim().toLowerCase()),
    ADMIN_USERNAME: z.string().regex(/^[a-z0-9._-]{3,30}$/),
    ADMIN_PASSWORD: z.string().min(12).max(128),
    ADMIN_NAME: z.string().min(1),
    ADMIN_EMAIL_OWNERSHIP_VERIFIED: z.literal("yes"),
  })
  .parse(process.env);
const existing = await db.person.findUnique({
  where: { email: input.ADMIN_EMAIL },
});
if (existing?.supabaseUserId)
  throw new Error(
    "This account is already linked; use supported password reset.",
  );
if (
  existing &&
  (existing.role !== "SUPER_ADMIN" || existing.status !== "ACTIVE")
)
  throw new Error(
    "Only an active, existing super admin can be explicitly linked during cutover.",
  );
const identity = await supabaseAdmin().auth.admin.createUser({
  email: input.ADMIN_EMAIL,
  password: input.ADMIN_PASSWORD,
  email_confirm: true,
  app_metadata: { encova_bootstrap: true },
  user_metadata: { name: input.ADMIN_NAME },
});
if (identity.error || !identity.data.user)
  throw new Error(
    "Supabase identity could not be provisioned. Inspect the Auth dashboard for an incomplete previous attempt; do not link arbitrary existing users.",
  );
try {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(987661)::text`;
    if (
      await tx.person.count({
        where: {
          supabaseUserId: { not: null },
          role: "SUPER_ADMIN",
          status: "ACTIVE",
        },
      })
    )
      throw new Error("An active Supabase super admin already exists.");
    const data = { supabaseUserId: identity.data.user.id };
    const person = existing
      ? await tx.person.update({ where: { id: existing.id }, data })
      : await tx.person.create({
          data: {
            ...data,
            email: input.ADMIN_EMAIL,
            username: input.ADMIN_USERNAME,
            displayName: input.ADMIN_NAME,
            role: "SUPER_ADMIN",
            status: "ACTIVE",
          },
        });
    await tx.audit.create({
      data: {
        actorId: person.id,
        action: "SUPABASE_ADMIN_BOOTSTRAPPED",
        entityId: person.id,
        changes: { provider: "supabase" },
        requestId: crypto.randomUUID(),
      },
    });
  });
} catch (error) {
  await supabaseAdmin().auth.admin.deleteUser(identity.data.user.id);
  throw error;
}
console.log(
  "Supabase super admin linked. Domain UUID/history preserved; no passwords or tokens printed.",
);
await db.$disconnect();
